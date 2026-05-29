import * as path from 'path';
import { getDebugInfoEntries } from '../debugInfoEntries';

describe('getDebugInfoEntries', () => {
  it('includes the current user schedules directory when an alias is provided', () => {
    const entries = getDebugInfoEntries(
      path.join('C:', 'Users', 'tester', 'AppData', 'Roaming', 'open-kosmos-app'),
      path.join('C:', 'Users', 'tester', 'AppData', 'Local', 'Temp', 'OpenKosmos Crashes'),
      'alice',
    );

    expect(entries).toEqual([
      {
        sourcePath: path.join('C:', 'Users', 'tester', 'AppData', 'Roaming', 'open-kosmos-app', 'logs'),
        zipPath: 'logs',
      },
      {
        sourcePath: path.join('C:', 'Users', 'tester', 'AppData', 'Roaming', 'open-kosmos-app', 'state', 'current-run.json'),
        zipPath: path.join('state', 'current-run.json'),
      },
      {
        sourcePath: path.join('C:', 'Users', 'tester', 'AppData', 'Roaming', 'open-kosmos-app', 'crashes'),
        zipPath: 'crashes',
      },
      {
        sourcePath: path.join('C:', 'Users', 'tester', 'AppData', 'Local', 'Temp', 'OpenKosmos Crashes'),
        zipPath: 'crashDumps',
      },
      {
        sourcePath: path.join('C:', 'Users', 'tester', 'AppData', 'Roaming', 'open-kosmos-app', 'profiles', 'alice', 'schedules'),
        zipPath: path.join('profiles', '<REDACTED_ALIAS>', 'schedules'),
      },
    ]);
  });

  it('omits the schedules directory when there is no current user alias', () => {
    const entries = getDebugInfoEntries('/tmp/open-kosmos-app', '/tmp/crashDumps', null);

    expect(entries).toEqual([
      {
        sourcePath: path.join('/tmp/open-kosmos-app', 'logs'),
        zipPath: 'logs',
      },
      {
        sourcePath: path.join('/tmp/open-kosmos-app', 'state', 'current-run.json'),
        zipPath: path.join('state', 'current-run.json'),
      },
      {
        sourcePath: path.join('/tmp/open-kosmos-app', 'crashes'),
        zipPath: 'crashes',
      },
      {
        sourcePath: '/tmp/crashDumps',
        zipPath: 'crashDumps',
      },
    ]);
  });
});