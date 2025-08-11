import { Job } from './Job';
import { Task } from '../models/Task';
import { area } from '@turf/area';

export class PolygonAreaJob implements Job {
    async run(task: Task): Promise<{ area: number; unit: string }> {
        console.log(`Calculating polygon area for task ${task.taskId}...`);

        try {
            if (!task.geoJson || task.geoJson.trim() === '') {
                throw new Error('Invalid GeoJSON: empty or null geoJson field');
            }

            let parsedGeoJson: any;
            try {
                parsedGeoJson = JSON.parse(task.geoJson);
            } catch (parseError) {
                throw new Error(`Invalid GeoJSON: failed to parse JSON - ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
            }

            if (!parsedGeoJson || typeof parsedGeoJson !== 'object') {
                throw new Error('Invalid GeoJSON: parsed result is not an object');
            }

            const feature = this.extractPolygonFeature(parsedGeoJson);

            const calculatedArea = area(feature);

            const result = {
                area: calculatedArea,
                unit: 'square meters'
            };

            task.output = JSON.stringify(result);
            return result;

        } catch (error) {
            console.error(`Error calculating polygon area for task ${task.taskId}:`, error);

            const errorResult = {
                error: 'Failed to calculate polygon area',
                message: error instanceof Error ? error.message : 'Unknown error',
                area: null,
                unit: 'square meters'
            };

            task.output = JSON.stringify(errorResult);
            throw error;
        }
    }

    private extractPolygonFeature(input: any): any {
        // Geometry object
        if (input.type === 'Polygon' || input.type === 'MultiPolygon') {
            return { type: 'Feature', geometry: input, properties: {} };
        }

        // Feature with geometry
        if (input.type === 'Feature') {
            if (input.geometry && (input.geometry.type === 'Polygon' || input.geometry.type === 'MultiPolygon')) {
                return input;
            }
            throw new Error('Invalid GeoJSON: feature missing Polygon/MultiPolygon geometry');
        }

        // FeatureCollection: pick first Polygon/MultiPolygon
        if (input.type === 'FeatureCollection' && Array.isArray(input.features)) {
            const candidate = input.features.find((f: any) => f?.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
            if (candidate) return candidate;
            throw new Error('Invalid GeoJSON: no Polygon/MultiPolygon geometry found in FeatureCollection');
        }

        // GeometryCollection: pick first Polygon/MultiPolygon
        if (input.type === 'GeometryCollection' && Array.isArray(input.geometries)) {
            const geom = input.geometries.find((g: any) => g?.type === 'Polygon' || g?.type === 'MultiPolygon');
            if (geom) return { type: 'Feature', geometry: geom, properties: {} };
            throw new Error('Invalid GeoJSON: no Polygon/MultiPolygon geometry found in GeometryCollection');
        }

        throw new Error(`Invalid GeoJSON: unsupported type '${input.type || 'unknown'}'`);
    }
}