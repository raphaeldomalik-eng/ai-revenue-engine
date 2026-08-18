import type { CommercialPlaybook, ProductSlug, SalesMotion, TerritoryCode } from "./commercial-model.ts";
import { commercialPlaybooks } from "./playbooks.ts";

export class UnsupportedCommercialPlaybookError extends Error {
  constructor(product: ProductSlug, territory: TerritoryCode, salesMotion: SalesMotion) {
    super(`No commercial playbook configured for ${product}/${territory}/${salesMotion}.`);
    this.name = "UnsupportedCommercialPlaybookError";
  }
}

export function resolveCommercialPlaybook(input: { product: ProductSlug; territory: TerritoryCode; salesMotion: SalesMotion }): CommercialPlaybook {
  const match = commercialPlaybooks.find((playbook) => playbook.product === input.product && playbook.territory === input.territory && playbook.salesMotion === input.salesMotion);
  if (!match) throw new UnsupportedCommercialPlaybookError(input.product, input.territory, input.salesMotion);
  return match;
}
