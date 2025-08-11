import { Router } from 'express';
import { AppDataSource } from '../data-source';
import { Workflow } from '../models/Workflow';
import { TaskStatus } from '../workers/taskRunner';
import { WorkflowStatus } from '../workflows/WorkflowFactory';

const router = Router();

router.get('/:id/status', async (req, res) => {
  const { id } = req.params;

  try {
    const workflowRepository = AppDataSource.getRepository(Workflow);
    const workflow = await workflowRepository.findOne({
      where: { workflowId: id },
      relations: ['tasks'],
    });

    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    const totalTasks = Array.isArray(workflow.tasks) ? workflow.tasks.length : 0;
    const completedTasks = Array.isArray(workflow.tasks)
      ? workflow.tasks.filter((t) => t.status === TaskStatus.Completed).length
      : 0;

    return res.json({
      workflowId: workflow.workflowId,
      status: workflow.status,
      completedTasks,
      totalTasks,
    });
  } catch (error) {
    console.error('Error fetching workflow status:', error);
    return res.status(500).json({ message: 'Failed to fetch workflow status' });
  }
});

export default router;

router.get('/:id/results', async (req, res) => {
  const { id } = req.params;

  try {
    const workflowRepository = AppDataSource.getRepository(Workflow);
    
    const workflow = await workflowRepository.findOne({
      where: { workflowId: id },
      relations: ['tasks']
    });

    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    if (workflow.status !== WorkflowStatus.Completed) {
      return res.status(400).json({
        message: 'Workflow is not completed yet',
        workflowId: workflow.workflowId,
        status: workflow.status,
      });
    }

    // Find the report generation task output
    const reportTask = workflow.tasks.find(task => task.taskType === 'reportGeneration');
    let finalResult = null;

    if (reportTask && reportTask.output) {
      try {
        finalResult = JSON.parse(reportTask.output);
      } catch {
        finalResult = reportTask.output;
      }
    } else {
      // Fallback: use workflow.finalResult if no report generation task
      finalResult = workflow.finalResult ? JSON.parse(workflow.finalResult) : null;
    }

    return res.json({
      workflowId: workflow.workflowId,
      status: workflow.status,
      finalResult,
    });
  } catch (error) {
    console.error('Error fetching workflow results:', error);
    return res.status(500).json({ message: 'Failed to fetch workflow results' });
  }
});

