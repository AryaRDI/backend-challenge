import { Job } from './Job';
import { Task } from '../models/Task';
import booleanWithin from '@turf/boolean-within';
import { Feature, Polygon } from 'geojson';
import countryMapping from '../data/world_data.json';

export class DataAnalysisJob implements Job {
    async run(task: Task): Promise<string> {
        console.log(`Running data analysis for task ${task.taskId}...`);

        // Use dependency input only if it looks like valid GeoJSON geometry/feature; otherwise fallback to geoJson
        const chooseGeoJson = (candidate: string | null | undefined, fallback: string): string => {
            if (!candidate) return fallback;
            try {
                const parsed = JSON.parse(candidate);
                if (!parsed || typeof parsed !== 'object') return fallback;
                if (
                    parsed.type === 'Feature' ||
                    parsed.type === 'Polygon' ||
                    parsed.type === 'MultiPolygon' ||
                    parsed.type === 'FeatureCollection' ||
                    parsed.type === 'GeometryCollection'
                ) {
                    return candidate;
                }
                return fallback;
            } catch (_) {
                return fallback;
            }
        };

        const selectedRaw = chooseGeoJson(task.input, task.geoJson);
        const parsedData = JSON.parse(selectedRaw);
        
        // Convert to Feature if needed (similar to PolygonAreaJob)
        let inputGeometry: Feature<Polygon>;
        if (parsedData.type === 'Feature') {
            inputGeometry = parsedData;
        } else if (parsedData.type === 'Polygon' || parsedData.type === 'MultiPolygon') {
            inputGeometry = {
                type: 'Feature',
                geometry: parsedData,
                properties: {}
            };
        } else {
            throw new Error(`Unsupported GeoJSON type: ${parsedData.type}`);
        }

        for (const countryFeature of countryMapping.features) {
            if (countryFeature.geometry.type === 'Polygon' || countryFeature.geometry.type === 'MultiPolygon') {
                const isWithin = booleanWithin(inputGeometry, countryFeature as Feature<Polygon>);
                if (isWithin) {
                    const result = countryFeature.properties?.name || 'Unknown country';
                    console.log(`The polygon is within ${result}`);
                    task.output = JSON.stringify({ country: result });
                    return result;
                }
            }
        }
        const result = 'No country found';
        task.output = JSON.stringify({ country: result });
        return result;
    }
}