import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/tenancy/types";
import { cn } from "@/lib/utils";

const SIZE_CLASS_NAME: Record<WidgetSize, string> = {
  sm: "sm:col-span-1",
  md: "sm:col-span-2",
  lg: "sm:col-span-2 lg:col-span-3",
  full: "col-span-full",
};

export interface WidgetFrameProps {
  title: string;
  size: WidgetSize;
  children: ReactNode;
}

function WidgetFrame({ title, size, children }: WidgetFrameProps) {
  return (
    <Card className={cn(SIZE_CLASS_NAME[size])}>
      {title ? (
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
      ) : null}
      <CardContent className={cn(!title && "pt-5")}>{children}</CardContent>
    </Card>
  );
}

export { WidgetFrame };
