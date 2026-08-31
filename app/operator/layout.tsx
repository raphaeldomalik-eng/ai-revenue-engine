import { OperatorShell } from "./operator-shell";
import "./operator.css";
import "./run-results.css";
import "./incoming-leads.css";
import "./incoming-leads-triage.css";
import "./incoming-leads-source-context.css";
import "./parity.css";

export default function OperatorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <OperatorShell>{children}</OperatorShell>;
}
