/**
 * Schedule Templates
 *
 * Predefined schedule templates that appear in the Schedules Tab.
 * Each template pre-fills the AddScheduleOverlay with sensible defaults
 * based on the agent's current configuration.
 */

import type { AgentConfig } from './types'

/**
 * The shape of `initialValues` accepted by AddScheduleOverlay.
 * Kept in sync manually — AddScheduleOverlay does not export its props.
 */
export interface ScheduleTemplateInitialValues {
  name?: string
  description?: string
  message?: string
  mode?: 'once' | 'recurring'
  recurringPreset?: 'daily' | 'daily_multi_times' | 'weekly' | 'monthly' | 'every_n_days' | 'every_n_weeks' | 'every_n_months'
  recurringTime?: string
}

export interface ScheduleTemplate {
  id: string
  label: string
  description: string
  /** Build the overlay's initialValues from the current agent config. */
  buildInitialValues: (agentData: Partial<AgentConfig>) => ScheduleTemplateInitialValues
  /** Whether the template is usable given the current agent config. */
  isAvailable: (agentData: Partial<AgentConfig>) => boolean
  /** Tooltip shown when the template is unavailable. */
  unavailableReason: string
}

/** All built-in schedule templates. Add new entries here. */
export const SCHEDULE_TEMPLATES: ScheduleTemplate[] = []
