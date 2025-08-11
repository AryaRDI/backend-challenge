import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { DataSource } from 'typeorm';
import { Workflow } from '../models/Workflow';
import { Task } from '../models/Task';
import {TaskStatus} from "../workers/taskRunner";
import { getJobForTaskType } from '../jobs/JobFactory';

export enum WorkflowStatus {
    Initial = 'initial',
    InProgress = 'in_progress',
    Completed = 'completed',
    Failed = 'failed'
}

interface WorkflowStep {
    taskType: string;
    stepNumber: number;
    dependsOn?: number | null; // stepNumber of the dependency
}

interface WorkflowDefinition {
    name: string;
    steps: WorkflowStep[];
}

export class WorkflowFactory {
    constructor(private dataSource: DataSource) {}

    /**
     * Creates a workflow by reading a YAML file and constructing the Workflow and Task entities.
     * @param filePath - Path to the YAML file.
     * @param clientId - Client identifier for the workflow.
     * @param geoJson - The geoJson data string for tasks (customize as needed).
     * @returns A promise that resolves to the created Workflow.
     */
    async createWorkflowFromYAML(filePath: string, clientId: string, geoJson: string): Promise<Workflow> {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const workflowDef = yaml.load(fileContent) as WorkflowDefinition;
        this.validateWorkflowDefinition(workflowDef);
        const workflowRepository = this.dataSource.getRepository(Workflow);
        const taskRepository = this.dataSource.getRepository(Task);
        const workflow = new Workflow();
        workflow.clientId = clientId;
        workflow.status = WorkflowStatus.Initial;

        console.log(`Creating workflow for clientId: ${clientId} with status: ${workflow.status}`);
        const savedWorkflow = await workflowRepository.save(workflow);

        // First create tasks without dependencies to get IDs
        const provisionalTasks: Task[] = workflowDef.steps.map(step => {
            const task = new Task();
            task.clientId = clientId;
            task.geoJson = geoJson;
            task.status = TaskStatus.Queued;
            task.taskType = step.taskType;
            task.stepNumber = step.stepNumber;
            task.workflow = savedWorkflow;
            return task;
        });

        const savedTasks = await taskRepository.save(provisionalTasks);

        // Build a map from stepNumber to task entity
        const stepToTask = new Map<number, Task>();
        for (const t of savedTasks) {
            stepToTask.set(t.stepNumber, t);
        }

        // Wire dependencies and possibly block tasks that depend on others
        for (const step of workflowDef.steps) {
            if (step.dependsOn != null) {
                const current = stepToTask.get(step.stepNumber)!;
                const dep = stepToTask.get(step.dependsOn);
                if (dep) {
                    current.dependsOn = dep;
                }
            }
        }

        await taskRepository.save(Array.from(stepToTask.values()));

        return savedWorkflow;
    }

    private validateWorkflowDefinition(def: WorkflowDefinition): void {
        if (!def || !def.name || !Array.isArray(def.steps) || def.steps.length === 0) {
            throw new Error('Invalid workflow: missing name or steps');
        }

        const seenSteps = new Set<number>();
        const stepNumbers = def.steps.map(s => s.stepNumber);
        for (const step of def.steps) {
            if (typeof step.stepNumber !== 'number' || step.stepNumber <= 0) {
                throw new Error(`Invalid workflow: stepNumber must be a positive number (got ${step.stepNumber})`);
            }
            if (seenSteps.has(step.stepNumber)) {
                throw new Error(`Invalid workflow: duplicate stepNumber ${step.stepNumber}`);
            }
            seenSteps.add(step.stepNumber);

            // Validate task type exists
            try {
                getJobForTaskType(step.taskType);
            } catch (e) {
                throw new Error(`Invalid workflow: unknown taskType '${step.taskType}' at step ${step.stepNumber}`);
            }

            // Validate dependsOn references an existing step number if provided
            if (step.dependsOn != null) {
                if (!stepNumbers.includes(step.dependsOn)) {
                    throw new Error(`Invalid workflow: dependsOn ${step.dependsOn} not found for step ${step.stepNumber}`);
                }
                if (step.dependsOn === step.stepNumber) {
                    throw new Error(`Invalid workflow: step ${step.stepNumber} cannot depend on itself`);
                }
            }
        }
    }
}