import { Router } from 'express';
import { AppDataSource } from '../data-source';
import { WorkflowFactory } from '../workflows/WorkflowFactory'; // Create a folder for factories if you prefer
import path from 'path';

const router = Router();
const workflowFactory = new WorkflowFactory(AppDataSource);

router.post('/', async (req, res) => {
    const { clientId, geoJson, workflowName } = req.body;
    const workflowFileName = workflowName || 'example_workflow';
    const workflowFile = path.join(__dirname, `../workflows/${workflowFileName}.yml`);

    try {
        const workflow = await workflowFactory.createWorkflowFromYAML(workflowFile, clientId, JSON.stringify(geoJson));

        res.status(202).json({
            workflowId: workflow.workflowId,
            message: 'Workflow created and tasks queued from YAML definition.'
        });
    } catch (error: any) {
        console.error('Error creating workflow:', error);
        const message = error?.message || 'Failed to create workflow';
        // Treat validation errors as 400 bad request
        const isValidation = typeof message === 'string' && message.startsWith('Invalid workflow:');
        res.status(isValidation ? 400 : 500).json({ message });
    }
});

export default router;