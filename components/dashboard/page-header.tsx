import React from "react";
import { cn } from "@/lib/utils";

type Color = "emerald" | "blue" | "orange" | "amber" | "violet" | "rose" | "teal" | "indigo";

const colorMap: Record<
  Color,
  { wrap: string; border: string; iconBg: string; iconText: string }
> = {
  emerald: { wrap: "bg-emerald-50", border: "border-emerald-100", iconBg: "bg-emerald-100", iconText: "text-emerald-600" },
  blue:    { wrap: "bg-blue-50",    border: "border-blue-100",    iconBg: "bg-blue-100",    iconText: "text-blue-600"    },
  orange:  { wrap: "bg-orange-50",  border: "border-orange-100",  iconBg: "bg-orange-100",  iconText: "text-orange-600"  },
  amber:   { wrap: "bg-amber-50",   border: "border-amber-100",   iconBg: "bg-amber-100",   iconText: "text-amber-600"   },
  violet:  { wrap: "bg-violet-50",  border: "border-violet-100",  iconBg: "bg-violet-100",  iconText: "text-violet-600"  },
  rose:    { wrap: "bg-rose-50",    border: "border-rose-100",    iconBg: "bg-rose-100",    iconText: "text-rose-600"    },
  teal:    { wrap: "bg-teal-50",    border: "border-teal-100",    iconBg: "bg-teal-100",    iconText: "text-teal-600"    },
  indigo:  { wrap: "bg-indigo-50",  border: "border-indigo-100",  iconBg: "bg-indigo-100",  iconText: "text-indigo-600"  },
};

interface PageHeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  color: Color;
  action?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  color,
  action,
  className,
}: PageHeaderProps) {
  const c = colorMap[color];
  return (
    <div
      className={cn(
        "rounded-xl border px-6 py-4 flex items-center justify-between gap-4",
        c.wrap,
        c.border,
        className
      )}
    >
      <div className="flex items-center gap-4 min-w-0">
        <div
          className={cn(
            "w-11 h-11 rounded-xl flex items-center justify-center shrink-0",
            c.iconBg
          )}
        >
          <Icon className={cn("h-5 w-5", c.iconText)} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 leading-tight">
            {title}
          </h1>
          {subtitle && (
            <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
