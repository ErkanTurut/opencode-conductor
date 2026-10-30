import type { JSX } from 'solid-js'
import type { StateTone } from './format'

export interface BadgeProps {
  label: string
  tone?: StateTone
  title?: string
}

/** A compact state chip. The tone drives the border, tint and dot only. */
export function Badge(props: BadgeProps) {
  return (
    <span class="cdt-badge" data-tone={props.tone ?? 'unknown'} title={props.title ?? props.label}>
      {props.label}
    </span>
  )
}

export interface EmptyStateProps {
  title: string
  body?: string
}

export function EmptyState(props: EmptyStateProps) {
  return (
    <div class="cdt-empty">
      <span class="cdt-empty-title">{props.title}</span>
      {props.body ? <span class="cdt-empty-body">{props.body}</span> : null}
    </div>
  )
}

export interface LoadingBlockProps {
  label: string
}

export function LoadingBlock(props: LoadingBlockProps) {
  return (
    <div class="cdt-empty" role="status" aria-live="polite">
      <span class="cdt-empty-body">{props.label}</span>
    </div>
  )
}

export interface SectionProps {
  title: string
  aside?: JSX.Element
  children: JSX.Element
}

export function Section(props: SectionProps) {
  return (
    <section class="cdt-section">
      <div class="cdt-row cdt-between">
        <h2 class="cdt-heading">{props.title}</h2>
        {props.aside}
      </div>
      {props.children}
    </section>
  )
}

export interface KeyValueProps {
  rows: Array<{ label: string; value: JSX.Element | string }>
}

export function KeyValue(props: KeyValueProps) {
  return (
    <dl class="cdt-kv">
      {props.rows.map((row) => (
        <>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </>
      ))}
    </dl>
  )
}
