import { Repository } from 'typeorm';
import { Task } from '../models/Task';
import { getJobForTaskType } from '../jobs/JobFactory';
import {WorkflowStatus} from "../workflows/WorkflowFactory";
import {Workflow} from "../models/Workflow";
import {Result} from "../models/Result";

export enum TaskStatus {
    Queued = 'queued',
    InProgress = 'in_progress',
    Completed = 'completed',
    Failed = 'failed'
}

export class TaskRunner {
    constructor(
        private taskRepository: Repository<Task>,
    ) {}

    /**
     * Runs the appropriate job based on the task's type, managing the task's status.
     * @param task - The task entity that determines which job to run.
     * @throws If the job fails, it rethrows the error.
     */
    async run(task: Task): Promise<void> {
        task.status = TaskStatus.InProgress;
        task.progress = 'starting job...';
        await this.taskRepository.save(task);
        const job = getJobForTaskType(task.taskType);

        const resultRepository = this.taskRepository.manager.getRepository(Result);
        let caughtError: any = null;

        try {
            console.log(`Starting job ${task.taskType} for task ${task.taskId}...`);
            // If there is a dependency, try to pass its output as this task's input
            if (task.dependsOn) {
                const depTask = await this.taskRepository.findOne({
                    where: { taskId: task.dependsOn.taskId }
                });
                if (depTask) {
                    if (depTask.status !== TaskStatus.Completed) {
                        throw new Error(`Dependent task ${depTask.taskId} not completed`);
                    }
                    task.input = depTask.output ?? null;
                }
            }

            const taskResult = await job.run(task);
            console.log(`Job ${task.taskType} for task ${task.taskId} completed successfully.`);
            const result = new Result();
            result.taskId = task.taskId!;
            result.data = JSON.stringify(taskResult || {});
            await resultRepository.save(result);
            task.resultId = result.resultId!;
            task.status = TaskStatus.Completed;
            task.progress = null;
            await this.taskRepository.save(task);

        } catch (error: any) {
            console.error(`Error running job ${task.taskType} for task ${task.taskId}:`, error);
            caughtError = error;

            task.status = TaskStatus.Failed;
            task.progress = null;
            await this.taskRepository.save(task);

        } finally {
            const workflowRepository = this.taskRepository.manager.getRepository(Workflow);
            const currentWorkflow = await workflowRepository.findOne({ where: { workflowId: task.workflow.workflowId }, relations: ['tasks'] });

            if (currentWorkflow) {
                const allCompleted = currentWorkflow.tasks.every(t => t.status === TaskStatus.Completed);
                const anyFailed = currentWorkflow.tasks.some(t => t.status === TaskStatus.Failed);

                if (anyFailed) {
                    currentWorkflow.status = WorkflowStatus.Failed;
                } else if (allCompleted) {
                    currentWorkflow.status = WorkflowStatus.Completed;
                } else {
                    currentWorkflow.status = WorkflowStatus.InProgress;
                }

                // Optionally aggregate finalResult only when terminal
                const noneActive = currentWorkflow.tasks.every(t => t.status === TaskStatus.Completed || t.status === TaskStatus.Failed);
                if (noneActive && (allCompleted || anyFailed)) {
                    const aggregated = currentWorkflow.tasks
                        .sort((a, b) => a.stepNumber - b.stepNumber)
                        .map(t => {
                            let parsedOutput: any = null;
                            if (t.output) {
                                try { parsedOutput = JSON.parse(t.output); } catch { parsedOutput = t.output; }
                            }
                            return {
                                taskId: t.taskId,
                                type: t.taskType,
                                stepNumber: t.stepNumber,
                                status: t.status,
                                output: t.status === TaskStatus.Completed ? parsedOutput : undefined,
                                error: t.status === TaskStatus.Failed ? (parsedOutput?.message || parsedOutput?.error || 'Task failed') : undefined
                            };
                        });
                    const finalPayload = {
                        workflowId: currentWorkflow.workflowId,
                        status: currentWorkflow.status,
                        tasks: aggregated,
                        generatedAt: new Date().toISOString()
                    };
                    currentWorkflow.finalResult = JSON.stringify(finalPayload);
                }

                await workflowRepository.save(currentWorkflow);
            }
        }

        if (caughtError) {
            throw caughtError;
        }
    }
}