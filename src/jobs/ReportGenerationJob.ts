import { Job } from './Job';
import { Task } from '../models/Task';
import { Workflow } from '../models/Workflow';
import { TaskStatus } from '../workers/taskRunner';

interface TaskReportEntry {
    taskId: string;
    type: string;
    stepNumber: number;
    status: string;
    output?: any;
    error?: string;
}

interface ReportData {
    workflowId: string;
    tasks: TaskReportEntry[];
    finalReport: string;
    summary: {
        totalTasks: number;
        completedTasks: number;
        failedTasks: number;
        reportGeneratedAt: string;
    };
}

export class ReportGenerationJob implements Job {
    async run(task: Task): Promise<ReportData> {
        console.log(`Generating report for workflow ${task.workflow.workflowId}...`);

        try {
            // Get all tasks in the workflow
            const workflowTasks = await this.getAllWorkflowTasks(task);
            
            // Filter out the current report generation task and get only preceding tasks
            const precedingTasks = workflowTasks
                .filter(t => t.taskId !== task.taskId && t.stepNumber < task.stepNumber)
                .sort((a, b) => a.stepNumber - b.stepNumber);

            // Check if all preceding tasks are completed or failed (not queued or in_progress)
            const incompleteTasks = precedingTasks.filter(t => 
                t.status === TaskStatus.Queued || t.status === TaskStatus.InProgress
            );

            if (incompleteTasks.length > 0) {
                throw new Error(`Cannot generate report: ${incompleteTasks.length} preceding tasks are still in progress`);
            }

            // Aggregate task outputs
            const taskEntries: TaskReportEntry[] = precedingTasks.map(t => {
                const entry: TaskReportEntry = {
                    taskId: t.taskId,
                    type: t.taskType,
                    stepNumber: t.stepNumber,
                    status: t.status
                };

                if (t.status === TaskStatus.Completed) {
                    try {
                        // Try to parse output as JSON, fallback to string
                        entry.output = t.output ? JSON.parse(t.output) : null;
                    } catch {
                        entry.output = t.output;
                    }
                } else if (t.status === TaskStatus.Failed) {
                    try {
                        // Try to parse error output
                        const errorOutput = t.output ? JSON.parse(t.output) : null;
                        entry.error = errorOutput?.message || errorOutput?.error || 'Task failed';
                        entry.output = errorOutput;
                    } catch {
                        entry.error = t.output || 'Task failed';
                    }
                }

                return entry;
            });

            // Generate summary
            const completedTasks = taskEntries.filter(t => t.status === TaskStatus.Completed).length;
            const failedTasks = taskEntries.filter(t => t.status === TaskStatus.Failed).length;

            // Generate final report text
            let finalReport = "Workflow Execution Report\n";
            finalReport += `========================\n`;
            finalReport += `Workflow ID: ${task.workflow.workflowId}\n`;
            finalReport += `Total Tasks: ${taskEntries.length}\n`;
            finalReport += `Completed: ${completedTasks}, Failed: ${failedTasks}\n\n`;

            if (completedTasks > 0) {
                finalReport += "Successful Tasks:\n";
                taskEntries
                    .filter(t => t.status === TaskStatus.Completed)
                    .forEach(t => {
                        finalReport += `- ${t.type} (Step ${t.stepNumber}): ${this.summarizeOutput(t.output)}\n`;
                    });
                finalReport += "\n";
            }

            if (failedTasks > 0) {
                finalReport += "Failed Tasks:\n";
                taskEntries
                    .filter(t => t.status === TaskStatus.Failed)
                    .forEach(t => {
                        finalReport += `- ${t.type} (Step ${t.stepNumber}): ${t.error}\n`;
                    });
                finalReport += "\n";
            }

            finalReport += `Report generated at: ${new Date().toISOString()}`;

            const reportData: ReportData = {
                workflowId: task.workflow.workflowId,
                tasks: taskEntries,
                finalReport,
                summary: {
                    totalTasks: taskEntries.length,
                    completedTasks,
                    failedTasks,
                    reportGeneratedAt: new Date().toISOString()
                }
            };

            // Save the report to the task's output field
            task.output = JSON.stringify(reportData);

            // Also save the report to the workflow's finalResult field
            const { AppDataSource } = await import('../data-source');
            const workflowRepository = AppDataSource.getRepository(Workflow);
            const workflow = await workflowRepository.findOne({
                where: { workflowId: task.workflow.workflowId }
            });
            
            if (workflow) {
                workflow.finalResult = JSON.stringify(reportData);
                await workflowRepository.save(workflow);
                console.log(`Final results saved to workflow ${task.workflow.workflowId}`);
            }

            console.log(`Report generated successfully for workflow ${task.workflow.workflowId}`);
            
            return reportData;

        } catch (error) {
            console.error(`Error generating report for workflow ${task.workflow.workflowId}:`, error);
            
            const errorReport: ReportData = {
                workflowId: task.workflow.workflowId,
                tasks: [],
                finalReport: `Error generating report: ${error instanceof Error ? error.message : 'Unknown error'}`,
                summary: {
                    totalTasks: 0,
                    completedTasks: 0,
                    failedTasks: 0,
                    reportGeneratedAt: new Date().toISOString()
                }
            };

            task.output = JSON.stringify(errorReport);
            throw error;
        }
    }

    private async getAllWorkflowTasks(currentTask: Task): Promise<Task[]> {
        // Import AppDataSource dynamically to avoid circular dependencies
        const { AppDataSource } = await import('../data-source');
        const taskRepository = AppDataSource.getRepository(Task);
        
        // Fetch all tasks in the workflow from the database
        const tasks = await taskRepository.find({
            where: { workflow: { workflowId: currentTask.workflow.workflowId } },
            relations: ['workflow']
        });
        
        return tasks;
    }

    private summarizeOutput(output: any): string {
        if (!output) return 'No output';
        
        if (typeof output === 'string') return output;
        
        if (typeof output === 'object') {
            // Special handling for different output types
            if (output.area !== undefined) {
                return `Area calculated: ${output.area} ${output.unit || 'square meters'}`;
            }
            if (output.country) {
                return `Location: ${output.country}`;
            }
            if (output.analysis) {
                return `Analysis: ${output.analysis}`;
            }
            // Generic object summary
            return Object.keys(output).join(', ');
        }
        
        return String(output);
    }
}