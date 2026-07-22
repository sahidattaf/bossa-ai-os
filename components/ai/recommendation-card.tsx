import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";

import { SeverityBadge } from "./severity-badge";

export interface RecommendationCardProps {
  href?: string;
  title: string;
  executiveSummary: string;
  severity: string;
  status: string;
  recommendationType: string;
}

export function RecommendationCard({ href, title, executiveSummary, severity, status, recommendationType }: RecommendationCardProps) {
  const content = (
    <Card className="transition-colors hover:bg-surface-elevated/50">
      <CardContent className="flex flex-col gap-2 pt-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <SeverityBadge severity={severity} />
        </div>
        <p className="text-xs text-muted-foreground">{executiveSummary}</p>
        <p className="text-xs text-muted-foreground">
          {recommendationType.replace(/_/g, " ")} · {status.replace(/_/g, " ")}
        </p>
      </CardContent>
    </Card>
  );

  return href ? (
    <Link href={href} className="block">
      {content}
    </Link>
  ) : (
    content
  );
}
