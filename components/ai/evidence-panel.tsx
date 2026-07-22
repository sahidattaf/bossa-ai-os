export interface EvidenceItemView {
  id: string;
  metricName: string;
  observedValue: unknown;
  expectedValue: unknown;
  calculationDefinition: string;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
}

/**
 * Renders whatever evidence rows the caller was given — permission-aware
 * redaction for finance-sensitive evidence (issue #18 scope 4) already
 * happened at the RLS layer (ai_recommendation_evidence's SELECT policy
 * hides is_finance_sensitive rows from viewers without finance.read), so
 * this component never needs its own redaction logic and can't accidentally
 * leak a row it was never given.
 */
export function EvidencePanel({ evidence }: { evidence: EvidenceItemView[] }) {
  if (evidence.length === 0) {
    return <p className="text-sm text-muted-foreground">No evidence recorded for this recommendation.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {evidence.map((item) => (
        <li key={item.id} className="rounded-md border border-border p-3 text-sm">
          <p className="font-medium text-foreground">{item.metricName.replace(/_/g, " ")}</p>
          <p className="text-xs text-muted-foreground">Observed: {JSON.stringify(item.observedValue)}</p>
          {item.expectedValue !== null && item.expectedValue !== undefined ? (
            <p className="text-xs text-muted-foreground">Expected: {JSON.stringify(item.expectedValue)}</p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">{item.calculationDefinition}</p>
          {item.sourceEntityType && item.sourceEntityId ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Source: {item.sourceEntityType} {item.sourceEntityId}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
