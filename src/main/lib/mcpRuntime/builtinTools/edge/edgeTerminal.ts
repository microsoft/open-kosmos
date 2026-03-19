import path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { edgeGlobal } from './edgeGlobal';
import { edgeCommandQueue, CommandResult } from './edgeCommandQueue';

function createPlatformCommand(directory: string, command: string): string {
  return process.platform === 'win32'
    ? `cd /d "${directory}" && ${command}`
    : `cd "${directory}" && ${command}`;
}

function initGlobalVariables(repoPath: string): void {
  if (!repoPath || repoPath.trim() === '') {
    console.error('[EdgeTerminal] Invalid repository path');
    edgeGlobal.setInitialized(false);
    return;
  }

  if (edgeGlobal.setRepoPath(repoPath)) {
    edgeCommandQueue.terminateShellSession();
    console.info(`[EdgeTerminal] Repository path set to: ${repoPath}`);
  }
}

async function runGclientSync(repoPath: string): Promise<CommandResult> {
  const absoluteRepoPath = path.resolve(repoPath);
  console.info(`[EdgeTerminal] Running gclient sync in: ${absoluteRepoPath}`);
  const cmd = createPlatformCommand(absoluteRepoPath, 'gclient sync -D -f');
  return await edgeCommandQueue.enqueue(cmd);
}

async function checkDepotTools(repoPath: string): Promise<CommandResult> {
  const depotToolsPath = path.join(repoPath, '..', 'depot_tools');
  const cmd = createPlatformCommand(depotToolsPath, 'git status --porcelain=v1 -z');
  const result = await edgeCommandQueue.enqueue(cmd);

  if (result.stdout.trim().length !== 0) {
    console.info('[EdgeTerminal] Depot tools are dirty, cleaning and updating...');
    await updateDepotTools(depotToolsPath);
  }

  return result;
}

async function updateDepotTools(depotToolsPath: string): Promise<CommandResult> {
  const cmd = createPlatformCommand(depotToolsPath, 'git restore --staged ./* && git checkout . && git pull');
  return await edgeCommandQueue.enqueue(cmd);
}

async function checkIfFileExistsAndDelete(
  fileName: string,
  directoryPath: string = os.tmpdir()
): Promise<boolean> {
  const fullPath = path.join(directoryPath, fileName);
  try {
    await fs.access(fullPath);
    await fs.unlink(fullPath);
    return true;
  } catch {
    return false;
  }
}

export async function initializeEdgeEnvironment(
  repoPath: string,
  buildPath?: string
): Promise<CommandResult> {
  try {
    if (edgeGlobal.getInitialized()) {
      return { stdout: 'Environment already initialized', stderr: '', code: 0 };
    }

    if (buildPath) {
      edgeGlobal.setBuildPath(buildPath);
    }

    checkIfFileExistsAndDelete('EdgeEnvConfigScript.cmd');
    initGlobalVariables(repoPath);

    const parentDir = path.resolve(repoPath, '..');
    const scriptPath = path.join(parentDir, 'depot_tools', 'scripts', 'setup', 'initEdgeEnv.cmd');
    const initCommand = `"${scriptPath}" "${parentDir}"`;
    const { stdout, stderr, code } = await edgeCommandQueue.enqueue(initCommand);

    if (code !== 0) {
      return { stdout, stderr, code };
    }

    await checkDepotTools(repoPath);
    const { stdout: syncStdout, stderr: syncStderr, code: syncCode } = await runGclientSync(repoPath);

    if (code === 0 && syncCode === 0) {
      edgeGlobal.setInitialized(true);
      console.info('[EdgeTerminal] Environment initialization completed successfully');
    }

    return {
      stdout: `${stdout}\n${syncStdout}`,
      stderr: `${stderr}\n${syncStderr}`,
      code: syncCode,
    };
  } catch (error) {
    console.error('[EdgeTerminal] Error initializing Edge Environment:', error);
    return { stdout: '', stderr: String(error), code: 1 };
  }
}

export async function runBuild(buildTarget: string): Promise<CommandResult> {
  const startTime = Date.now();
  console.info(`[EdgeTerminal] Starting build for target: ${buildTarget}`);

  try {
    if (!edgeGlobal.getInitialized()) {
      return { stdout: '', stderr: 'Environment not initialized. Please run edge_init_environment first.', code: 1 };
    }

    const buildDir = edgeGlobal.getBuildPath();
    const cmd = createPlatformCommand(buildDir, `autoninja ${buildTarget}`);
    const result = await edgeCommandQueue.enqueue(cmd);
    const duration = Date.now() - startTime;

    if (result.code === 0) {
      console.info(`[EdgeTerminal] Build completed for ${buildTarget} (${duration}ms)`);
    } else {
      console.error(`[EdgeTerminal] Build failed for ${buildTarget}`, { code: result.code });
    }

    return result;
  } catch (error) {
    return { stdout: '', stderr: String(error), code: 1 };
  }
}

export async function runTests(testTarget: string, testFilter: string): Promise<CommandResult> {
  const startTime = Date.now();
  console.info(`[EdgeTerminal] Starting tests for target: ${testTarget}`);

  try {
    if (!edgeGlobal.getInitialized()) {
      return { stdout: '', stderr: 'Environment not initialized. Please run edge_init_environment first.', code: 1 };
    }

    const buildDir = edgeGlobal.getBuildPath();
    const cmd = createPlatformCommand(buildDir, `${testTarget} --gtest_filter=${testFilter}`);
    const result = await edgeCommandQueue.enqueue(cmd);
    const duration = Date.now() - startTime;

    if (result.code === 0) {
      console.info(`[EdgeTerminal] Tests completed for ${testTarget} (${duration}ms)`);
    } else {
      console.error(`[EdgeTerminal] Tests failed for ${testTarget}`, { code: result.code });
    }

    return result;
  } catch (error) {
    return { stdout: '', stderr: String(error), code: 1 };
  }
}
