import { DataSource } from 'typeorm';
import { Task } from './models/Task';
import {Result} from "./models/Result";
import {Workflow} from "./models/Workflow";

export const AppDataSource = new DataSource({
    type: 'sqlite',
    database: 'data/database.sqlite',
    dropSchema: true, // Changed to false to preserve data between restarts
    entities: [Task, Result, Workflow],
    synchronize: true,
    logging: false,
});
