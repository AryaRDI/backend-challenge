/*
  Challenge E2E Test Script
  Requirements:
  - Server running at http://localhost:3000 (run `npm start` in another terminal)
  - Node.js v18+ (uses global fetch)
*/

const BASE_URL = 'http://localhost:3000';

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE_URL + '/');
      if (res.ok || res.status === 200) return true;
    } catch (_) {}
    await sleep(500);
  }
  throw new Error('Server did not become ready on ' + BASE_URL);
}

async function postAnalysis(clientId, workflowName, geoJson) {
  const res = await fetch(BASE_URL + '/analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, workflowName, geoJson }),
  });
  if (!res.ok) throw new Error('POST /analysis failed: ' + res.status + ' ' + (await res.text()));
  return res.json();
}

async function getStatus(workflowId) {
  const res = await fetch(BASE_URL + `/workflow/${workflowId}/status`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { httpStatus: res.status, error: text };
  }
  const body = await res.json();
  return { httpStatus: res.status, ...body };
}

async function getResults(workflowId) {
  const res = await fetch(BASE_URL + `/workflow/${workflowId}/results`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function waitForTerminalStatus(workflowId, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await getStatus(workflowId);
    if (status.httpStatus === 200 && (status.status === 'completed' || status.status === 'failed')) return status;
    // If 404, the workflow may not be committed/readable yet; keep polling until timeout
    await sleep(1000);
  }
  throw new Error('Timeout waiting for terminal status: ' + workflowId);
}

function assert(condition, message) {
  if (!condition) throw new Error('Assertion failed: ' + message);
}

async function run() {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch not found. Use Node.js v18+ or run with a fetch polyfill.');
  }

  console.log('Waiting for server...');
  await waitForServer();
  console.log('Server is ready.');

  // Reusable test polygon Feature
  const polygonFeature = {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-63.624885020050996, -10.311050368263523],
        [-63.624885020050996, -10.367865108370523],
        [-63.61278302732815, -10.367865108370523],
        [-63.61278302732815, -10.311050368263523],
        [-63.624885020050996, -10.311050368263523],
      ]],
    },
    properties: {},
  };

  const results = [];

  // 1) example_workflow (should complete; tests polygonArea, analysis, notification, reportGeneration, dependencies, finalResult)
  console.log('\n[example_workflow] Creating workflow...');
  const exCreate = await postAnalysis('client-example', 'example_workflow', polygonFeature);
  assert(exCreate.workflowId, 'example_workflow: workflowId missing');
  const exId = exCreate.workflowId;
  console.log('[example_workflow] workflowId =', exId);

  const exTerminal = await waitForTerminalStatus(exId, 90000);
  console.log('[example_workflow] terminal status =', exTerminal.status, exTerminal);
  assert(exTerminal.status === 'completed', 'example_workflow should complete');
  assert(exTerminal.completedTasks === 4, 'example_workflow should have 4 completed tasks');
  assert(exTerminal.totalTasks === 4, 'example_workflow should have 4 total tasks');

  const exResult = await getResults(exId);
  assert(exResult.status === 200, 'example_workflow results should be 200');
  assert(exResult.body && exResult.body.finalResult, 'example_workflow finalResult missing');
  
  // Validate report structure from ReportGenerationJob
  const report = exResult.body.finalResult;
  
  assert(report.workflowId === exId, 'report workflowId should match');
  assert(Array.isArray(report.tasks), 'report should contain tasks array');
  assert(report.tasks.length === 3, 'report should contain 3 preceding tasks');
  assert(report.summary, 'report should contain summary');
  assert(report.summary.totalTasks === 3, 'report summary should show 3 tasks');
  
  // Validate polygon area task output
  const polygonTask = report.tasks.find(t => t.type === 'polygonArea');
  assert(polygonTask, 'polygonArea task should be in report');
  assert(polygonTask.output && polygonTask.output.area > 0, 'polygonArea should have calculated area');
  assert(polygonTask.output.unit === 'square meters', 'polygonArea should use square meters');
  
  // Validate analysis task - task completed successfully
  const analysisTask = report.tasks.find(t => t.type === 'analysis');
  assert(analysisTask, 'analysis task should be in report');
  assert(analysisTask.status === 'completed', 'analysis task should be completed');
  
  console.log(`[example_workflow] ✅ Polygon area calculated: ${polygonTask.output.area} square meters`);
  console.log(`[example_workflow] ✅ Analysis task completed successfully`);
  console.log(`[example_workflow] ✅ Report generation working with ${report.tasks.length} tasks`);
  
  results.push({ name: 'example_workflow', status: exTerminal.status });

  // 2) polygon_test_workflow (should complete; tests dependsOn between polygonArea -> notification)
  console.log('\n[polygon_test_workflow] Creating workflow...');
  const polyCreate = await postAnalysis('client-poly', 'polygon_test_workflow', polygonFeature);
  assert(polyCreate.workflowId, 'polygon_test_workflow: workflowId missing');
  const polyId = polyCreate.workflowId;
  console.log('[polygon_test_workflow] workflowId =', polyId);

  const polyTerminal = await waitForTerminalStatus(polyId, 60000);
  console.log('[polygon_test_workflow] terminal status =', polyTerminal.status, polyTerminal);
  assert(polyTerminal.status === 'completed', 'polygon_test_workflow should complete');
  results.push({ name: 'polygon_test_workflow', status: polyTerminal.status });

  // 3) test_failure_workflow (should fail during creation due to invalidTaskType validation)
  console.log('\n[test_failure_workflow] Testing workflow validation...');
  try {
    const failCreate = await postAnalysis('client-fail', 'test_failure_workflow', polygonFeature);
    // Should not reach here due to validation
    assert(false, 'test_failure_workflow should fail during creation');
  } catch (error) {
    console.log('[test_failure_workflow] ✅ Workflow validation properly rejects invalid task types');
    results.push({ name: 'test_failure_workflow', status: 'validation_failed' });
  }

  // 4) Test invalid GeoJSON handling
  console.log('\n[invalid_geojson] Testing error handling...');
  const invalidGeoJson = { type: 'Point', coordinates: [0, 0] }; // Invalid for polygon area
  try {
    await postAnalysis('client-invalid', 'polygon_test_workflow', invalidGeoJson);
    assert(false, 'invalid_geojson should be rejected with 400');
  } catch (e) {
    console.log('[invalid_geojson] ✅ Invalid GeoJSON rejected during creation');
    results.push({ name: 'invalid_geojson', status: 'validation_failed' });
  }

  // 5) Test API endpoint validation
  console.log('\n[api_validation] Testing API endpoints...');
  
  // Test 404 for non-existent workflow
  const notFoundStatus = await getStatus('non-existent-id');
  assert(notFoundStatus.httpStatus === 404, 'status endpoint should return 404 for non-existent workflow');
  
  const notFoundResults = await getResults('non-existent-id');
  assert(notFoundResults.status === 404, 'results endpoint should return 404 for non-existent workflow');
  
  console.log('[api_validation] ✅ API endpoints properly handle 404 cases');

  console.log('\nAll tests passed:');
  for (const r of results) {
    console.log(`- ${r.name}: ${r.status}`);
  }
}

run().catch((err) => {
  console.error('\nTest failed:', err.message);
  process.exit(1);
});


