# Furniture Scraper

A modular Node.js scraper built with Playwright that extracts product information from furniture websites and stores it in a Supabase database.

## Features

- **Multi-retailer support** with an adapter-based architecture
- Crawls product category pages of furniture websites
- Extracts product links from category pages, handling pagination
- Fetches detailed product information from product pages
- Stores standardized product data in Supabase
- Implements rate limiting to avoid getting blocked
- Provides a REST API to trigger scraping jobs

## Supported Retailers

- IKEA - fully implemented
- Wayfair - example implementation (may need adjustment)

## Adding New Retailers

The adapter-based architecture makes it easy to add support for new retailers:

1. Create a new adapter in `adapters/retailers/`
2. Extend the `BaseAdapter` class and implement required methods
3. Add the new retailer to the `AdapterFactory`

## Prerequisites

- Node.js (v18 or later)
- A Supabase account and project set up

## Installation

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Configure your environment variables in `.env`:
   ```
   SUPABASE_URL=your-supabase-url
   SUPABASE_KEY=your-supabase-service-role-key
   DELAY_BETWEEN_REQUESTS=1500
   MAX_CONCURRENT_REQUESTS=2
   PORT=3000
   API_KEY=your-secret-api-key
   ```

## Database Setup

Create a `products` table in your Supabase project with the following schema:

| Column     | Type           | Description                |
|------------|----------------|----------------------------|
| id         | UUID           | Primary key (auto)         |
| retailer   | TEXT           | Retailer name              |
| product_id | TEXT           | Product identifier         |
| name       | TEXT           | Product name               |
| slug       | TEXT           | URL slug                   |
| price      | JSONB          | Price information          |
| raw_data   | JSONB          | Complete product data      |
| url        | TEXT           | Product URL                |
| created_at | TIMESTAMPTZ    | Creation timestamp (auto)  |

You can use the provided `supabase-schema.sql` file to set up your database schema.

## Usage

### Running the scraper directly

To run the scraper from the command line:

```bash
npm start
```

By default, the scraper will extract products from IKEA. You can specify a different retailer or category URL using environment variables:

```bash
# Scrape IKEA sofas
RETAILER=IKEA CATEGORY_URL=https://www.ikea.com/ca/en/cat/sofas-fu003/ npm start

# Scrape Wayfair beds
RETAILER=Wayfair CATEGORY_URL=https://www.wayfair.ca/furniture/pdp/beds-c1870737.html npm start

# Specify country and language
RETAILER=IKEA COUNTRY=us LANGUAGE=en npm start
```

### Using the API server

The project includes a REST API server that allows you to trigger scraping jobs:

1. Start the API server:
   ```bash
   npm run server
   ```

2. Trigger a scrape job (using curl or any HTTP client):
   ```bash
   curl -X POST http://localhost:3000/api/scrape \
     -H "Content-Type: application/json" \
     -d '{
       "apiKey": "your-secret-api-key", 
       "retailer": "IKEA", 
       "categoryUrl": "https://www.ikea.com/ca/en/cat/chairs-fu002/"
     }'
   ```

3. Get supported retailers:
   ```bash
   curl -X GET http://localhost:3000/api/retailers
   ```

### Multi-Category Scraping

The `examples` directory contains a script that demonstrates how to scrape multiple categories:

```bash
node examples/multi-category-scrape.js
```

## Configuration

Adjust these settings in the `.env` file:

- `DELAY_BETWEEN_REQUESTS`: Time to wait between requests (in ms)
- `MAX_CONCURRENT_REQUESTS`: Maximum number of concurrent requests
- `PORT`: Port for the API server
- `API_KEY`: Secret key for API authentication

## Project Structure

```
furniture-scraper/
├── adapters/                 # Adapter architecture
│   ├── base-adapter.js       # Base adapter interface
│   ├── adapter-factory.js    # Factory for creating adapters
│   └── retailers/            # Retailer-specific adapters
│       ├── ikea-adapter.js
│       └── wayfair-adapter.js
├── examples/                 # Example scripts
├── index.js                  # Main entry point
├── scraper.js                # Core scraper class
├── server.js                 # API server
├── supabase-schema.sql       # Database schema
└── .env                      # Environment variables
```

## License

ISC 