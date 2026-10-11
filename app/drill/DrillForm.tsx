'use client';

import type { Field } from '../lib/drills/types';
import type { DrillConfig } from '../types';

type Props = {
  fields: Field<DrillConfig>[];
  config: DrillConfig;
  /** One setting changed. The page resolves the result, so anything may be passed. */
  onChange: (key: string, value: unknown) => void;
};

const input = 'rounded-block border-2 border-rule bg-night px-2 py-1 text-snow';

/** A drill's settings form, drawn from its field list. */
export function DrillForm({ fields, config, onChange }: Props) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {fields.map((field) => {
        const value = config[field.key];
        if (field.kind === 'multi') {
          const picked = value as string[];
          return (
            <fieldset key={field.key} className="space-y-2 sm:col-span-2">
              <legend className="eyebrow mb-2">{field.label}</legend>
              <div className="flex flex-wrap gap-2">
                {field.options.map((option) => {
                  const on = picked.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`btn ${on ? 'btn-primary' : ''}`}
                      aria-pressed={on}
                      // The last one can't be turned off; resolving would only put the default back.
                      disabled={on && picked.length === 1}
                      onClick={() =>
                        onChange(field.key, on ? picked.filter((v) => v !== option.value) : [...picked, option.value])
                      }
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        }
        if (field.kind === 'toggle') {
          return (
            <label key={field.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={value as boolean} onChange={(e) => onChange(field.key, e.target.checked)} />
              {field.label}
            </label>
          );
        }
        const id = `drill-${field.key}`;
        return (
          <div key={field.key} className="space-y-2">
            <label htmlFor={id} className="eyebrow block">
              {field.label}
            </label>
            {field.kind === 'choice' ? (
              <select id={id} className={`${input} w-full`} value={value as string} onChange={(e) => onChange(field.key, e.target.value)}>
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.kind === 'number' ? (
              <input
                id={id}
                type="number"
                className={`${input} w-24`}
                min={field.min}
                max={field.max}
                step={field.step ?? 1}
                value={value as number}
                onChange={(e) => onChange(field.key, Number(e.target.value))}
              />
            ) : (
              <input
                id={id}
                type="text"
                className={`${input} w-full`}
                placeholder={field.hint}
                value={value as string}
                onChange={(e) => onChange(field.key, e.target.value)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
