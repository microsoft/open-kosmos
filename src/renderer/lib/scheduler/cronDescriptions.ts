interface NormalizedCronParts {
  minute: string
  hour: string
  dayOfMonth: string
  month: string
  dayOfWeek: string
}

export interface DailyMultiTimesCronResult {
  cronExpression?: string
  normalizedTimes: string[]
  error?: string
}

const TIME_TOKEN_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/
const SHORT_WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function normalizeCronParts(cron?: string): NormalizedCronParts | null {
  if (!cron) return null

  const parts = cron.trim().split(/\s+/)
  if (parts.length === 5) {
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
    return { minute, hour, dayOfMonth, month, dayOfWeek }
  }

  if (parts.length === 6) {
    const [, minute, hour, dayOfMonth, month, dayOfWeek] = parts
    return { minute, hour, dayOfMonth, month, dayOfWeek }
  }

  return null
}

function parseNumericList(token: string): number[] | null {
  if (!/^\d+(,\d+)*$/.test(token)) {
    return null
  }

  return token
    .split(',')
    .map((item) => Number(item))
    .filter((value) => !Number.isNaN(value))
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function formatTimes(hours: number[], minute: number): string {
  return hours.map((hour) => formatTime(hour, minute)).join(', ')
}

export function buildDailyMultiTimesCronExpression(input: string): DailyMultiTimesCronResult {
  const normalizedInput = input.replace(/，/g, ',')
  const rawTokens = normalizedInput
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  if (rawTokens.length === 0) {
    return {
      normalizedTimes: [],
      error: 'Provide at least one time in HH:mm format.',
    }
  }

  const uniqueTimes = Array.from(new Set(rawTokens.map((item) => {
    const match = item.match(TIME_TOKEN_REGEX)
    if (!match) return item
    return `${match[1]}:${match[2]}`
  })))

  for (const time of uniqueTimes) {
    if (!TIME_TOKEN_REGEX.test(time)) {
      return {
        normalizedTimes: [],
        error: `Invalid time "${time}". Use HH:mm, for example 04:00, 08:00, 14:00.`,
      }
    }
  }

  const minuteValues = Array.from(new Set(uniqueTimes.map((time) => Number(time.split(':')[1]))))
  if (minuteValues.length !== 1) {
    return {
      normalizedTimes: [],
      error: 'A single daily multi-time schedule currently requires all times to use the same minute.',
    }
  }

  const normalizedTimes = uniqueTimes.sort((left, right) => left.localeCompare(right))
  const minute = minuteValues[0]
  const hours = normalizedTimes.map((time) => Number(time.split(':')[0]))

  return {
    normalizedTimes,
    cronExpression: `${minute} ${hours.join(',')} * * *`,
  }
}

export function parseDailyMultiTimesCronExpression(cron?: string): string[] | null {
  const parts = normalizeCronParts(cron)
  if (!parts) return null

  if (parts.dayOfMonth !== '*' || parts.month !== '*' || parts.dayOfWeek !== '*') {
    return null
  }

  const minutes = parseNumericList(parts.minute)
  const hours = parseNumericList(parts.hour)
  if (!minutes || minutes.length !== 1 || !hours || hours.length < 2) {
    return null
  }

  return [...hours]
    .sort((left, right) => left - right)
    .map((hour) => formatTime(hour, minutes[0]))
}

export function describeCronExpression(cron?: string): string {
  if (!cron) return 'No cron expression'

  const parts = normalizeCronParts(cron)
  if (!parts) return cron

  if (parts.minute === '*' && parts.hour === '*' && parts.dayOfMonth === '*' && parts.month === '*' && parts.dayOfWeek === '*') {
    return 'Every minute'
  }

  if (/^\d+$/.test(parts.minute) && parts.hour === '*' && parts.dayOfMonth === '*' && parts.month === '*' && parts.dayOfWeek === '*') {
    return `At minute ${parts.minute} of every hour`
  }

  const minutes = parseNumericList(parts.minute)
  const hours = parseNumericList(parts.hour)
  const minute = minutes && minutes.length === 1 ? minutes[0] : null

  if (parts.dayOfMonth === '*' && parts.month === '*') {
    if (parts.dayOfWeek === '*') {
      if (parts.minute.startsWith('*/') && parts.hour === '*') {
        return `Every ${parts.minute.slice(2)} minutes`
      }

      if (parts.minute === '0' && parts.hour.startsWith('*/')) {
        return `Every ${parts.hour.slice(2)} hours`
      }

      if (minute !== null && hours && hours.length > 0) {
        return hours.length === 1
          ? `Every day at ${formatTime(hours[0], minute)}`
          : `Every day at ${formatTimes(hours, minute)}`
      }
    }

    if (minute !== null && hours && hours.length > 0) {
      if (parts.dayOfWeek === '1-5') {
        return hours.length === 1
          ? `Weekdays at ${formatTime(hours[0], minute)}`
          : `Weekdays at ${formatTimes(hours, minute)}`
      }

      if (parts.dayOfWeek === '0,6' || parts.dayOfWeek === '6,0') {
        return hours.length === 1
          ? `Weekends at ${formatTime(hours[0], minute)}`
          : `Weekends at ${formatTimes(hours, minute)}`
      }

      if (/^[0-6]$/.test(parts.dayOfWeek)) {
        const weekday = SHORT_WEEKDAY_NAMES[Number(parts.dayOfWeek)] || parts.dayOfWeek
        return hours.length === 1
          ? `${weekday} ${formatTime(hours[0], minute)}`
          : `${weekday} ${formatTimes(hours, minute)}`
      }
    }
  }

  return cron
}
