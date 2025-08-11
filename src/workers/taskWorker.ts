import {AppDataSource} from '../data-source';
import {Task} from '../models/Task';
import {TaskRunner, TaskStatus} from './taskRunner';

export async function taskWorker() {
    const taskRepository = AppDataSource.getRepository(Task);
    const taskRunner = new TaskRunner(taskRepository);

    while (true) {
        // Fetch all queued tasks and try to run the first unblocked one, preferring lower step numbers
        const queuedTasks = await taskRepository.find({
            where: { status: TaskStatus.Queued },
            relations: ['workflow', 'dependsOn']
        });

        if (queuedTasks.length > 0) {
            queuedTasks.sort((a, b) => a.stepNumber - b.stepNumber);

            let ranOne = false;
            for (const task of queuedTasks) {
                try {
                    let blocked = false;
                    if (task.dependsOn) {
                        const depStatus = task.dependsOn.status;
                        if (depStatus === TaskStatus.Queued || depStatus === TaskStatus.InProgress || depStatus === TaskStatus.Failed) {
                            blocked = true;
                        }
                    } else {
                        const siblingTasks = await taskRepository.find({
                            where: { workflow: { workflowId: task.workflow.workflowId } },
                            relations: ['workflow']
                        });
                        const blockers = siblingTasks.filter(t => t.stepNumber < task.stepNumber && (t.status === TaskStatus.Queued || t.status === TaskStatus.InProgress));
                        blocked = blockers.length > 0;
                    }

                    if (!blocked) {
                        await taskRunner.run(task);
                        ranOne = true;
                        break;
                    }
                } catch (error) {
                    console.error('Task execution failed. Task status has already been updated by TaskRunner.');
                    console.error(error);
                }
            }
            // If none could run due to blockers, just wait and try again
        }

        // Wait before checking for the next task again
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}