-- Create products table
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  retailer TEXT NOT NULL,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT,
  price JSONB,
  raw_data JSONB NOT NULL,
  url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create composite index on retailer and product_id for faster lookups
CREATE INDEX IF NOT EXISTS products_retailer_product_id_idx ON products (retailer, product_id);

-- Create RLS (Row Level Security) policies
-- Only authenticated users can read
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users" 
  ON products FOR SELECT 
  USING (auth.role() = 'authenticated');

-- Only service role or server can insert/update
CREATE POLICY "Enable write access for service role" 
  ON products FOR INSERT 
  USING (auth.role() = 'service_role');

CREATE POLICY "Enable update access for service role" 
  ON products FOR UPDATE 
  USING (auth.role() = 'service_role'); 