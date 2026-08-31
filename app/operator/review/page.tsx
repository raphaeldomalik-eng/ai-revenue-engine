import { redirect } from "next/navigation";

export default function ReviewPage() { redirect("/operator/prospects?saved=NEEDS_REVIEW"); }
