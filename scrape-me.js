// Test script for 1stDibs scraper
import { chromium } from 'playwright';
import { FirstDibsAdapter } from './adapters/retailers/firstdibs-adapter.js';
import fs from 'fs/promises';
import path from 'path';
import pLimit from 'p-limit';

const DEBUG_MODE = process.env.DEBUG === 'true';

// Configuration settings
const CONCURRENCY = 5; // Set concurrency to 5
const PAGE_TIMEOUT = 30000; // 30 seconds timeout (default)
const PROGRESS_INTERVAL = 10; // Save progress every 10 items
const MAX_PAGES_TO_SCRAPE = Infinity; // Set to Infinity to scrape all available pages

async function test1stDibsScraper() {
  console.log('Starting 1stDibs scraper test...');
  
  // Create the 1stDibs adapter
  const adapter = new FirstDibsAdapter();
  console.log(`Initialized adapter for: ${adapter.getRetailerName()}`);
  
  // Create main results directory if it doesn't exist
  const mainResultsDir = './results';
  try {
    await fs.mkdir(mainResultsDir, { recursive: true });
    console.log(`Created or verified main results directory: ${mainResultsDir}`);
  } catch (error) {
    console.error('Error creating main results directory:', error);
  }
  
  // Create a timestamped directory for this scraping session
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sessionDir = path.join(mainResultsDir, `scrape-${timestamp}`);
  
  try {
    await fs.mkdir(sessionDir, { recursive: true });
    console.log(`Created session directory: ${sessionDir}`);
  } catch (error) {
    console.error('Error creating session directory:', error);
    return; // Exit if we can't create the session directory
  }
  
  // Create a products directory within the session directory
  const productsDir = path.join(sessionDir, 'products');
  try {
    await fs.mkdir(productsDir, { recursive: true });
    console.log(`Created products directory: ${productsDir}`);
  } catch (error) {
    console.error('Error creating products directory:', error);
  }
  
  // Create a log file for this session
  const logFilePath = path.join(sessionDir, 'scrape-log.txt');
  
  // Get default categories
  const categories = adapter.getCategories();
  console.log('Available categories:');
  categories.forEach((cat, i) => console.log(`  ${i+1}. ${cat.name}: ${cat.url}`));
  
  // Select the first category for testing
  const testCategory = categories[0];
  console.log(`\nTesting with category: ${testCategory.name} (${testCategory.url})`);
  
  console.log(`Using concurrency level of ${CONCURRENCY} (processing ${CONCURRENCY} products simultaneously)`);
  console.log(`Will scrape all available products from the category`);

  // Launch browser with standard settings
  const browser = await chromium.launch({ 
    headless: true // Run in headless mode
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });
  
  const page = await context.newPage();
  
  // Initialize tracking variables
  let successCount = 0;
  let failureCount = 0;
  
  try {
    // Log basic info
    await appendToLog(logFilePath, `1stDibs Scraper Test - ${new Date().toISOString()}`);
    await appendToLog(logFilePath, `Category: ${testCategory.name} (${testCategory.url})`);
    
    // Step 1: Extract product links from the category page
    console.log('\n--- STEP 1: Extracting product links ---');
    await appendToLog(logFilePath, '\n--- STEP 1: Extracting product links ---');
    
    // Ensure page is fully loaded
    console.log('Waiting for page to be fully loaded...');
    await page.goto(testCategory.url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000); // Additional wait for dynamic content
    
    // Take screenshots at key points
    await page.screenshot({ path: path.join(sessionDir, 'debug-category-page.png') });
    
    // Extract ALL product links from all pages
    const productLinks = await extractProductLinks(adapter, page, testCategory.url, MAX_PAGES_TO_SCRAPE);
    console.log(`Found a total of ${productLinks.length} product links across all pages`);
    await appendToLog(logFilePath, `Found a total of ${productLinks.length} product links across all pages`);
    
    // Save the list of product links to a file
    const linksFilePath = path.join(sessionDir, 'product-links.json');
    await fs.writeFile(linksFilePath, JSON.stringify(productLinks, null, 2));
    console.log(`Saved all product links to ${linksFilePath}`);
    
    // Process ALL products - no limit
    const testProducts = productLinks;
    console.log(`Processing all ${testProducts.length} products from the category`);
    await appendToLog(logFilePath, `Processing all ${testProducts.length} products from the category`);
    
    // Set up concurrency limit
    const limit = pLimit(CONCURRENCY);
    
    // Array to collect all products
    let scrapedProducts = [];
    
    // Add timestamp to track total processing time
    const startTime = new Date();
    
    // For periodic progress saving
    const progressFilePath = path.join(sessionDir, 'progress_all_products.json');
    
    // Process products in parallel with controlled concurrency
    const productPromises = testProducts.map((url, i) => {
      return limit(async () => {
        const productIndex = i + 1;
        console.log(`\nProcessing product ${productIndex}/${testProducts.length}: ${url}`);
        
        // Create a new browser context for each product
        const productContext = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
        });
        const productPage = await productContext.newPage();
        
        try {
          const productData = await adapter.extractProductData(productPage, url);
          if (productData) {
            console.log(`✅ Product ${productIndex}: Successfully extracted raw product data`);
            await appendToLog(logFilePath, `✅ Product ${productIndex}: Successfully extracted raw product data`);
            
            // Transform the data to standardized format
            const transformedData = adapter.transformProductData(productData);
            if (transformedData) {
              console.log(`✅ Product ${productIndex}: Successfully transformed product data`);
              await appendToLog(logFilePath, `✅ Product ${productIndex}: Successfully transformed product data`);
              
              // Save individual product file
              const productFilename = `product_${productIndex}.json`;
              const productPath = path.join(productsDir, productFilename);
              await fs.writeFile(productPath, JSON.stringify(transformedData, null, 2));
              console.log(`✅ Product ${productIndex}: Saved to ${productFilename}`);
              
              // Track success
              successCount++;
              
              // Return the transformed data to be collected
              return transformedData;
            } else {
              console.log(`❌ Product ${productIndex}: Failed to transform product data`);
              await appendToLog(logFilePath, `❌ Product ${productIndex}: Failed to transform product data`);
              failureCount++;
              return null;
            }
          } else {
            console.log(`❌ Product ${productIndex}: Failed to extract product data`);
            await appendToLog(logFilePath, `❌ Product ${productIndex}: Failed to extract product data`);
            failureCount++;
            return null;
          }
        } catch (productError) {
          console.error(`Error processing product ${productIndex}:`, productError.message);
          await appendToLog(logFilePath, `❌ Product ${productIndex} Error: ${productError.message}`);
          failureCount++;
          return null;
        } finally {
          await productContext.close(); // Close the context when done
          
          // Save progress periodically for large scrapes
          if (productIndex % PROGRESS_INTERVAL === 0 || productIndex === testProducts.length) {
            const currentProgress = {
              timestamp: new Date().toISOString(),
              totalProducts: testProducts.length,
              processed: productIndex,
              successCount,
              failureCount,
              elapsedMinutes: ((new Date() - startTime) / 1000 / 60).toFixed(2)
            };
            
            console.log(`📊 Progress update: ${currentProgress.processed}/${currentProgress.totalProducts} products processed (${currentProgress.elapsedMinutes} minutes elapsed)`);
            await fs.writeFile(
              progressFilePath, 
              JSON.stringify(currentProgress, null, 2)
            ).catch(err => console.error('Error saving progress:', err));
          }
        }
      });
    });
    
    // Wait for all products to be processed
    console.log('\nWaiting for all parallel product processing to complete...');
    const results = await Promise.all(productPromises);
    
    // Filter out failed products (null values)
    scrapedProducts = results.filter(Boolean);
    console.log(`\nProcessed ${results.length} products, with ${scrapedProducts.length} successful extractions`);
    
    // Calculate total elapsed time
    const totalMinutes = ((new Date() - startTime) / 1000 / 60).toFixed(2);
    console.log(`Total processing time: ${totalMinutes} minutes`);
    await appendToLog(logFilePath, `Total processing time: ${totalMinutes} minutes`);
    
    // Save all results to a single file
    const allResultsPath = path.join(sessionDir, 'all_products.json');
    await fs.writeFile(allResultsPath, JSON.stringify(scrapedProducts, null, 2));
    console.log(`\n✅ Saved all ${scrapedProducts.length} products to ${allResultsPath}`);
    await appendToLog(logFilePath, `\n✅ Saved all ${scrapedProducts.length} products to ${allResultsPath}`);
    
    // Final summary
    const summary = {
      timestamp: new Date().toISOString(),
      category: testCategory.name,
      totalProductsFound: productLinks.length,
      productsScraped: testProducts.length,
      successCount: successCount,
      failureCount: failureCount,
      totalSaved: scrapedProducts.length,
      processingTimeMinutes: totalMinutes
    };
    
    const summaryPath = path.join(sessionDir, 'summary.json');
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
    
    console.log('\n--- Test completed successfully ---');
    console.log('Summary:', summary);
    await appendToLog(logFilePath, '\n--- Test completed successfully ---');
    await appendToLog(logFilePath, `Summary: ${JSON.stringify(summary, null, 2)}`);
    
  } catch (error) {
    console.error('Error during test:', error);
    await appendToLog(logFilePath, `Fatal error: ${error.message}`);
  } finally {
    await browser.close();
    console.log('Browser closed. Test finished.');
    await appendToLog(logFilePath, 'Test finished. Browser closed.');
  }
}

// Helper function to append to log file
async function appendToLog(filePath, message) {
  try {
    await fs.appendFile(filePath, message + '\n');
  } catch (error) {
    console.error('Error writing to log file:', error);
  }
}

// Helper function to extract product links with pagination
async function extractProductLinks(adapter, page, categoryUrl, maxPages = Infinity) {
  let allLinks = [];
  let currentPage = 1;
  let hasNextPage = true;
  
  // Initial extraction
  const links = await adapter.extractProductLinksFromCategory(page, categoryUrl);
  allLinks.push(...links);
  console.log(`Page ${currentPage}: Found ${links.length} products. Total: ${allLinks.length}`);
  
  // Handle pagination (will go until no more pages or maxPages is reached)
  while (hasNextPage && currentPage < maxPages) {
    console.log(`Attempting to navigate to page ${currentPage + 1}...`);
    hasNextPage = await adapter.goToNextPage(page);
    if (hasNextPage) {
      currentPage++;
      console.log(`Successfully moved to page ${currentPage}`);
      
      // Extract products from the new page
      const newLinks = await adapter.extractProductLinksFromCategory(page, page.url());
      allLinks.push(...newLinks);
      console.log(`Page ${currentPage}: Found ${newLinks.length} products. Total: ${allLinks.length}`);
    } else {
      console.log(`No more pages available after page ${currentPage}`);
    }
  }
  
  // Remove any duplicate URLs
  const uniqueLinks = [...new Set(allLinks)];
  console.log(`Found ${uniqueLinks.length} unique product links (removed ${allLinks.length - uniqueLinks.length} duplicates)`);
  
  return uniqueLinks;
}

// Run the test
test1stDibsScraper().catch(console.error); 