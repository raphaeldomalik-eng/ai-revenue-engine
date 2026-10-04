import { Suspense } from "react";
import { CatalogueView } from "./catalogue-view";

export const metadata = {
  title: "Entity Catalogue · AI Revenue Engine",
  description: "Cross-product operator workspace for the discovered Prestige entity estate",
};

export default function CataloguePage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: "40px 20px", color: "#65746c", textAlign: "center" }}>
          Loading Entity Catalogue workspace…
        </div>
      }
    >
      <CatalogueView />
    </Suspense>
  );
}
