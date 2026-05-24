/**
 * Analytics test script.
 * Prints simulated app_close / midnight events for validating KQL queries.
 *
 * Usage:
 *   npx ts-node scripts/test-analytics-events.ts
 *
 * Optional arguments:
 *   --days=7       Generate data for the past N days (default: 7)
 *   --users=5      Simulate N users (default: 5)
 */

import { randomUUID } from 'crypto';

// ==================== Argument parsing ====================

const args = process.argv.slice(2);
const daysArg = args.find(a => a.startsWith('--days='));
const usersArg = args.find(a => a.startsWith('--users='));

const DAYS = daysArg ? parseInt(daysArg.split('=')[1], 10) : 7;
const USER_COUNT = usersArg ? parseInt(usersArg.split('=')[1], 10) : 5;

// ==================== Simulated users ====================

interface SimulatedEvent {
  name: string;
  deviceId: string;
  locale: string;
  timestamp: Date;
  duration?: number;  // milliseconds
}

/**
 * Generate a fixed list of device IDs (consistent across runs for easy comparison).
 */
function generateDeviceIds(count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(`test-device-${String(i + 1).padStart(3, '0')}-${randomUUID().slice(0, 8)}`);
  }
  return ids;
}

/**
 * Random integer in [min, max].
 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate events for a single user on a given date.
 *
 * Simulated scenarios:
 *   Scenario A (70%): Opened and closed within the same day
 *     → app_start + app_close (duration: 10min ~ 4h)
 *
 *   Scenario B (20%): Cross-midnight usage
 *     → app_start (previous day 22:00-23:30)
 *     → midnight (duration: time used before midnight 30min ~ 2h)
 *     → app_close (current day 00:00 ~ 02:00, duration: 0 ~ 2h)
 *
 *   Scenario C (10%): Multiple sessions in the same day
 *     → 2-3 × app_start + app_close
 */
function generateEventsForUserDay(deviceId: string, date: Date): SimulatedEvent[] {
  const events: SimulatedEvent[] = [];
  const locale = ['zh-CN', 'en-US', 'ja-JP'][randomInt(0, 2)];
  const scenario = Math.random();

  if (scenario < 0.7) {
    // Scenario A: Single session on the same day
    const startHour = randomInt(8, 20);
    const startMin = randomInt(0, 59);
    const durationMs = randomInt(10 * 60, 4 * 60 * 60) * 1000;  // 10min ~ 4h

    const startTime = new Date(date);
    startTime.setHours(startHour, startMin, 0, 0);

    const closeTime = new Date(startTime.getTime() + durationMs);

    events.push({
      name: 'app_start',
      deviceId,
      locale,
      timestamp: startTime,
    });

    events.push({
      name: 'app_close',
      deviceId,
      locale,
      timestamp: closeTime,
      duration: durationMs,
    });

  } else if (scenario < 0.9) {
    // Scenario B: Cross-midnight usage
    const prevDay = new Date(date);
    prevDay.setDate(prevDay.getDate() - 1);

    const startHour = randomInt(22, 23);
    const startMin = randomInt(0, 30);
    const startTime = new Date(prevDay);
    startTime.setHours(startHour, startMin, 0, 0);

    // Midnight timestamp
    const midnightTime = new Date(date);
    midnightTime.setHours(0, 0, 0, 0);
    const midnightDuration = midnightTime.getTime() - startTime.getTime();

    // Close time 00:30 ~ 02:00
    const closeMin = randomInt(30, 120);
    const closeTime = new Date(midnightTime.getTime() + closeMin * 60 * 1000);
    const closeDuration = closeTime.getTime() - midnightTime.getTime();

    events.push({
      name: 'app_start',
      deviceId,
      locale,
      timestamp: startTime,
    });

    events.push({
      name: 'midnight',
      deviceId,
      locale,
      timestamp: midnightTime,
      duration: midnightDuration,
    });

    events.push({
      name: 'app_close',
      deviceId,
      locale,
      timestamp: closeTime,
      duration: closeDuration,
    });

  } else {
    // Scenario C: Multiple sessions in the same day
    const sessions = randomInt(2, 3);
    let currentHour = randomInt(8, 10);

    for (let s = 0; s < sessions; s++) {
      const startMin = randomInt(0, 59);
      const durationMs = randomInt(10 * 60, 2 * 60 * 60) * 1000;  // 10min ~ 2h

      const startTime = new Date(date);
      startTime.setHours(currentHour, startMin, 0, 0);

      const closeTime = new Date(startTime.getTime() + durationMs);

      events.push({
        name: 'app_start',
        deviceId,
        locale,
        timestamp: startTime,
      });

      events.push({
        name: 'app_close',
        deviceId,
        locale,
        timestamp: closeTime,
        duration: durationMs,
      });

      // Gap between sessions: 1-3 hours
      currentHour = closeTime.getHours() + randomInt(1, 3);
      if (currentHour >= 23) break;
    }
  }

  return events;
}

/**
 * Generate all simulated events.
 */
function generateAllEvents(): SimulatedEvent[] {
  const deviceIds = generateDeviceIds(USER_COUNT);
  const allEvents: SimulatedEvent[] = [];

  console.log(`\n📋 Simulation config:`);
  console.log(`   Days: ${DAYS}`);
  console.log(`   Users: ${USER_COUNT}`);
  console.log(`   Device IDs:`);
  deviceIds.forEach(id => console.log(`     - ${id}`));
  console.log('');

  for (let d = 0; d < DAYS; d++) {
    const date = new Date();
    date.setDate(date.getDate() - (DAYS - 1 - d));
    date.setHours(0, 0, 0, 0);

    // Each day: randomly 60%-100% of users are active
    const activeCount = Math.max(1, Math.floor(USER_COUNT * (0.6 + Math.random() * 0.4)));
    const activeDevices = deviceIds.slice(0, activeCount);

    for (const deviceId of activeDevices) {
      const events = generateEventsForUserDay(deviceId, date);
      allEvents.push(...events);
    }
  }

  // Sort by time
  allEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return allEvents;
}

// ==================== Send ====================

async function sendEvents(events: SimulatedEvent[]): Promise<void> {
  console.log(`\n🔍 Printing events (${events.length} total)\n`);
  printEventsSummary(events);
}

/**
 * Print event summary
 */
function printEventsSummary(events: SimulatedEvent[]): void {
  console.log('==================== Event Summary ====================\n');

  const byType: Record<string, number> = {};
  const byDate: Record<string, { app_start: number; app_close: number; midnight: number }> = {};

  for (const event of events) {
    byType[event.name] = (byType[event.name] || 0) + 1;

    const dateKey = event.timestamp.toISOString().slice(0, 10);
    if (!byDate[dateKey]) {
      byDate[dateKey] = { app_start: 0, app_close: 0, midnight: 0 };
    }
    byDate[dateKey][event.name as keyof typeof byDate[string]]++;
  }

  console.log('📊 Event type statistics:');
  for (const [type, count] of Object.entries(byType)) {
    console.log(`   ${type}: ${count}`);
  }

  console.log('\n📅 Daily event distribution:');
  console.log('   Date         | app_start | app_close | midnight');
  console.log('   -------------|-----------|-----------|----------');
  for (const [date, counts] of Object.entries(byDate).sort()) {
    console.log(`   ${date}  |     ${String(counts.app_start).padStart(5)} |     ${String(counts.app_close).padStart(5)} |    ${String(counts.midnight).padStart(5)}`);
  }

  // Print duration stats
  const closeDurations = events
    .filter(e => e.name === 'app_close' && e.duration)
    .map(e => e.duration! / 1000);
  const midnightDurations = events
    .filter(e => e.name === 'midnight' && e.duration)
    .map(e => e.duration! / 1000);

  if (closeDurations.length > 0) {
    const avg = closeDurations.reduce((a, b) => a + b, 0) / closeDurations.length;
    const min = Math.min(...closeDurations);
    const max = Math.max(...closeDurations);
    console.log(`\n⏱️  app_close duration stats (seconds):`);
    console.log(`   avg=${Math.round(avg)}s  min=${Math.round(min)}s  max=${Math.round(max)}s`);
  }

  if (midnightDurations.length > 0) {
    const avg = midnightDurations.reduce((a, b) => a + b, 0) / midnightDurations.length;
    console.log(`\n⏱️  midnight duration stats (seconds):`);
    console.log(`   avg=${Math.round(avg)}s  count=${midnightDurations.length}`);
  }

  console.log('\n==================================================');
  console.log(`\n💡 Note: Events typically take 2-5 minutes to appear in Application Insights`);
  console.log(`\n📝 Validation KQL:`);
  console.log(`
customEvents
| where customDimensions.appVersion == "0.0.0-test"
| where name in ("app_start", "app_close", "midnight")
| summarize count() by name, bin(timestamp, 1d)
| order by timestamp desc
`);
  console.log(`\n📝 Average usage duration KQL:`);
  console.log(`
customEvents
| where name in ("app_close", "midnight")
| where customDimensions.appVersion == "0.0.0-test"
| where isnotnull(customMeasurements.duration)
| extend duration_sec = todouble(customMeasurements.duration) / 1000
| summarize avg_usage_sec = round(avg(duration_sec), 0) by bin(timestamp, 1d)
| order by timestamp asc
`);
}

// ==================== Main entry point ====================

async function main(): Promise<void> {
  console.log('🧪 Analytics Test Script');
  console.log('='.repeat(50));

  const events = generateAllEvents();

  await sendEvents(events);

  // Ensure process exits
  setTimeout(() => process.exit(0), 2000);
}

main().catch((err) => {
  console.error('❌ Script execution failed:', err);
  process.exit(1);
});
