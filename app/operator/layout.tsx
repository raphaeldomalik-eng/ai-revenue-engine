import { OperatorShell } from "./operator-shell";
import "./operator.css";

export default function OperatorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <OperatorShell>{children}</OperatorShell>;
}
