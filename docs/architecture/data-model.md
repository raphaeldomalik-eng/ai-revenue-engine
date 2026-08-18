# Data model

Accounts and contacts are shared across products. One account can have many product opportunities. A product opportunity is tied to a product and commercial program; never create product-specific lead tables. All revenue tables use RLS and have no browser policies in this foundation, so access is fail-closed by design.
