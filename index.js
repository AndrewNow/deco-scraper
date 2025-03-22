// Furniture Scraper - Main Entry Point
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import pLimit from 'p-limit';
import fs from 'fs/promises';
import path from 'path';

// Load environment variables
dotenv.config();

// Supabase setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Constants and configuration
const DEFAULT_CATEGORY_URL = 'https://www.ikea.com/ca/en/cat/beds-bm003/';
const CATEGORY_URL = process.env.CATEGORY_URL || DEFAULT_CATEGORY_URL;
const DELAY_BETWEEN_REQUESTS = parseInt(process.env.DELAY_BETWEEN_REQUESTS || '1500');
const MAX_CONCURRENT_REQUESTS = parseInt(process.env.MAX_CONCURRENT_REQUESTS || '2');
const CACHE_FILE = 'crawled.json';

// Initialize rate limiter
const limit = pLimit(MAX_CONCURRENT_REQUESTS);

// Cache operations
async function loadCache() {
  try {
    const data = await fs.readFile(CACHE_FILE, 'utf8');
    return new Set(JSON.parse(data));
  } catch (error) {
    return new Set();
  }
}

async function saveCache(cache) {
  await fs.writeFile(CACHE_FILE, JSON.stringify([...cache]), 'utf8');
}

// Random delay function to avoid detection
function randomDelay() {
  const jitter = Math.floor(Math.random() * 500);
  return new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS + jitter));
}

// Extract all product links from a category page, including pagination
async function getAllProductLinksFromCategory(page, url) {
  console.log(`Visiting category page: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle' });
  
  const productLinks = new Set();
  let hasNextPage = true;
  let currentPage = 1;
  
  while (hasNextPage) {
    console.log(`Processing page ${currentPage} of category...`);
    
    // Extract product links from current page
    const links = await page.$$eval('a[href*="/ca/en/p/"]', links => 
      links.map(link => link.href)
    );
    
    links.forEach(link => productLinks.add(link));
    console.log(`Found ${links.length} products on page ${currentPage}. Total unique products: ${productLinks.size}`);
    
    // Check if there's a next page button and click it
    const nextButton = await page.$('button[aria-label="Next"]');
    if (nextButton && await nextButton.isVisible()) {
      await nextButton.click();
      await page.waitForLoadState('networkidle');
      currentPage++;
      // Small delay between pagination
      await randomDelay();
    } else {
      hasNextPage = false;
    }
  }
  
  return [...productLinks];
}

// Extract product JSON from a product page
async function extractProductJsonFromPage(page, url) {
  console.log(`Visiting product page: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle' });
  
  try {
    // Try to extract JSON-LD data
    const jsonLd = await page.$eval(
      'script[type="application/ld+json"]', 
      el => JSON.parse(el.textContent)
    );
    
    // Get product URL slug
    const slug = new URL(url).pathname.split('/').pop();
    
    // Extract IKEA ID from URL or product data
    let ikeaId = '';
    if (url.includes('/p/')) {
      const urlParts = url.split('/p/')[1].split('/');
      ikeaId = urlParts[1] || urlParts[0];
    } else if (jsonLd && jsonLd.sku) {
      ikeaId = jsonLd.sku;
    }
    
    return {
      jsonLd,
      url,
      slug,
      ikeaId
    };
  } catch (error) {
    console.error(`Error extracting JSON from ${url}:`, error.message);
    return null;
  }
}

// Save product data to Supabase
async function saveToSupabase(productData) {
  if (!productData || !productData.jsonLd) return false;
  
  try {
    const { jsonLd, url, slug, ikeaId } = productData;
    
    // Prepare data for insertion
    const product = {
      ikea_id: ikeaId,
      name: jsonLd.name || '',
      slug: slug,
      price: jsonLd.offers ? JSON.stringify(jsonLd.offers) : null,
      raw_data: jsonLd,
      url: url
    };
    
    // Insert data into Supabase
    const { error } = await supabase.from('products').insert([product]);
    
    if (error) {
      console.error('Error saving to Supabase:', error.message);
      return false;
    }
    
    console.log(`Saved product: ${product.name} (${product.ikea_id})`);
    return true;
  } catch (error) {
    console.error('Error in saveToSupabase:', error.message);
    return false;
  }
}

// Main execution
async function main() {
  console.log('Starting IKEA furniture scraper...');
  console.log(`Target category URL: ${CATEGORY_URL}`);
  
  // Check if Supabase credentials are set
  if (!supabaseUrl || !supabaseKey) {
    console.error('Error: Supabase credentials not set. Please check your .env file.');
    process.exit(1);
  }
  
  // Load cache of previously crawled products
  const crawledCache = await loadCache();
  console.log(`Loaded cache with ${crawledCache.size} previously crawled products`);
  
  // Launch browser
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
  });
  
  try {
    // Create page
    const page = await context.newPage();
    
    // Get all product links from category
    const productLinks = await getAllProductLinksFromCategory(page, CATEGORY_URL);
    console.log(`Found a total of ${productLinks.length} product links`);
    
    // Statistics
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    
    // Process each product link
    const promises = productLinks.map(url => limit(async () => {
      // Skip if already crawled
      if (crawledCache.has(url)) {
        console.log(`Skipping already crawled product: ${url}`);
        skippedCount++;
        return;
      }
      
      try {
        // Create a new page for each product to avoid state conflicts
        const productPage = await context.newPage();
        
        // Extract product data
        const productData = await extractProductJsonFromPage(productPage, url);
        
        // Save to Supabase if data was successfully extracted
        if (productData) {
          const success = await saveToSupabase(productData);
          if (success) {
            successCount++;
            crawledCache.add(url);
          } else {
            errorCount++;
          }
        } else {
          errorCount++;
        }
        
        // Close the product page
        await productPage.close();
        
        // Random delay between requests
        await randomDelay();
      } catch (error) {
        console.error(`Error processing ${url}:`, error.message);
        errorCount++;
      }
    }));
    
    // Wait for all promises to resolve
    await Promise.all(promises);
    
    // Save updated cache
    await saveCache(crawledCache);
    
    // Final stats
    console.log('\n--- Final Statistics ---');
    console.log(`✅ Successfully scraped and saved: ${successCount} products`);
    console.log(`⚠️ Skipped (already crawled): ${skippedCount} products`);
    console.log(`❌ Failed to process: ${errorCount} products`);
    console.log(`Total products attempted: ${productLinks.length}`);
    
  } catch (error) {
    console.error('Error in main execution:', error);
  } finally {
    // Close browser
    await browser.close();
  }
}

// Run the main function
main().catch(console.error); 