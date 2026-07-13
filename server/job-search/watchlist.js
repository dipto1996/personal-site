export const COMPANY_WATCHLIST = [
  "Capital One", "American Express", "JPMorgan Chase", "Goldman Sachs", "Morgan Stanley",
  "Citigroup", "Wells Fargo", "Bank of America", "Mastercard", "Visa", "PayPal", "Stripe",
  "Block", "Adyen", "Plaid", "Brex", "Ramp", "Chime", "SoFi", "Affirm", "Klarna", "Nubank",
  "Robinhood", "Coinbase", "Mercury", "Airwallex", "Wise", "Revolut", "Checkout.com", "Marqeta",
  "Highnote", "Modern Treasury", "Column", "Alloy", "Socure", "Sardine", "Unit", "Lithic",
  "OpenAI", "Anthropic", "Google", "Microsoft", "Amazon", "Meta", "Databricks", "Snowflake",
  "Palantir", "Scale AI", "Perplexity", "Cohere", "Mistral AI", "Hugging Face", "Glean",
  "Writer", "Sierra", "Harvey", "Hebbia", "Abridge", "OpenEvidence", "PostHog", "Notion",
  "Figma", "Canva", "Atlassian", "HubSpot", "Salesforce", "ServiceNow", "Cloudflare", "MongoDB",
  "Confluent", "dbt Labs", "Hightouch", "Fivetran", "Amplitude", "Mixpanel", "Contentsquare",
  "Rippling", "Deel", "Remote", "Gusto", "Carta", "Navan", "Oscar Health", "Lemonade",
  "Datadog", "Samsara", "DoorDash", "Uber", "Airbnb", "Instacart", "Spotify", "Netflix",
];

export function rotatingWatchlistCompanies(date = new Date(), count = 4) {
  const offset = Math.floor(date.getTime() / 86400000) % COMPANY_WATCHLIST.length;
  return Array.from({ length: count }, (_, index) => COMPANY_WATCHLIST[(offset + index) % COMPANY_WATCHLIST.length]);
}
