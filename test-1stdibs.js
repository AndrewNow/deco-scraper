// Test script for 1stDibs scraper
import { chromium } from 'playwright';
import { FirstDibsAdapter } from './adapters/retailers/firstdibs-adapter.js';
import fs from 'fs/promises';
import path from 'path';
import pLimit from 'p-limit';

// Debugging mode flag - commented out as it's only for debugging
// const DEBUG_MODE = process.env.DEBUG === 'true';

// Concurrency settings
const CONCURRENCY = 10; // Process 10 products simultaneously - adjust based on your system's capabilities
const SAVE_DELAY = 1000; // 1 second delay between requests as a baseline
const SAVE_INTERVAL = 10; // Save all products file every X completed products

async function test1stDibsScraper() {
  console.log('Starting 1stDibs scraper with concurrency...');
  
  // Create the 1stDibs adapter with concurrency setting
  const adapter = new FirstDibsAdapter('us', 'en', CONCURRENCY);
  console.log(`Initialized adapter for: ${adapter.getRetailerName()} with concurrency: ${CONCURRENCY}`);
  
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
  
  // Log basic info
  await appendToLog(logFilePath, `1stDibs Scraper Test - ${new Date().toISOString()}`);
  await appendToLog(logFilePath, `Concurrency: ${CONCURRENCY}`);
  
  // Get default categories
  const categories = adapter.getCategories();
  console.log('Available categories:');
  categories.forEach((cat, i) => console.log(`  ${i+1}. ${cat.name}: ${cat.url}`));
  
  // Select the first category for testing
  const testCategory = categories[0];
  console.log(`\nUsing category: ${testCategory.name} (${testCategory.url})`);
  await appendToLog(logFilePath, `Category: ${testCategory.name} (${testCategory.url})`);
  
  // Launch browser
  let browser = null;
  
  try {
    // Launch browser with appropriate settings
    // Always use headless mode for production (removing DEBUG flag)
    browser = await chromium.launch({ 
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox'],
    });
    
    console.log('Browser launched successfully');
    
    // Create a browser context for category navigation
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
      viewport: { width: 1280, height: 720 }
    });
    
    console.log('Starting product link extraction...');
    await appendToLog(logFilePath, '\n--- STEP 1: Extracting product links ---');
    
    // Create a page for category browsing
    const page = await context.newPage();
    
    try {
      // Navigate to the category page without taking screenshots
      await page.goto(testCategory.url, { waitUntil: 'networkidle' });
      
      // Extract product links, allowing for multiple pages
      const productLinks = await extractProductLinks(adapter, page, testCategory.url, 3); // Get 3 pages worth of products
      console.log(`Found ${productLinks.length} product links`);
      await appendToLog(logFilePath, `Found ${productLinks.length} product links`);
      
      // Save product links to file
      const linksFilePath = path.join(sessionDir, 'product-links.json');
      await fs.writeFile(linksFilePath, JSON.stringify(productLinks, null, 2));
      console.log(`Saved product links to ${linksFilePath}`);
      
      // Close the category page
      await page.close();
      await context.close();
      
      // Process products with concurrency if we have any links
      if (productLinks.length > 0) {
        console.log('\n--- STEP 2: Processing products with concurrency ---');
        await appendToLog(logFilePath, '\n--- STEP 2: Processing products with concurrency ---');
        
        // Define file paths for all products files
        const progressFilePath = path.join(sessionDir, 'progress.json');
        const allProductsPath = path.join(sessionDir, 'all_products.json');
        const allProductsObjectPath = path.join(sessionDir, 'all_products_object.json');
        
        // Track all successfully scraped products
        const allScrapedProducts = [];
        
        // For saving all products periodically
        let lastSaveCount = 0;
        
        // Function to save all products files
        const saveAllProductsFiles = async () => {
          // Save as array of products
          await fs.writeFile(allProductsPath, JSON.stringify(allScrapedProducts, null, 2));
          
          // Also save as a single JSON object with product IDs as keys
          const productsObject = {};
          allScrapedProducts.forEach(product => {
            const id = product.product_id || `product_${Math.random().toString(36).substring(2, 10)}`;
            productsObject[id] = product;
          });
          
          await fs.writeFile(allProductsObjectPath, JSON.stringify(productsObject, null, 2));
          console.log(`✅ Saved ${allScrapedProducts.length} products to all_products files (interim save)`);
        };
        
        // Setup concurrency options with callbacks
        const concurrencyOptions = {
          // When a product is successfully processed
          onSuccess: async (product, index) => {
            // Add to our collection of all products
            allScrapedProducts.push(product);
            
            // Save each product to its own file
            const productFileName = `product_${index}.json`;
            const productFilePath = path.join(productsDir, productFileName);
            await fs.writeFile(productFilePath, JSON.stringify(product, null, 2));
            console.log(`✅ Saved product ${index} to ${productFileName}`);
            await appendToLog(logFilePath, `✅ Product ${index}: Saved to ${productFileName}`);
            
            // Periodically save all products files
            if (allScrapedProducts.length % SAVE_INTERVAL === 0 && 
                allScrapedProducts.length > lastSaveCount) {
              await saveAllProductsFiles();
              lastSaveCount = allScrapedProducts.length;
            }
          },
          
          // When a product fails
          onFailure: async (url, errorMessage, index) => {
            console.log(`❌ Failed to process product ${index}: ${errorMessage}`);
            await appendToLog(logFilePath, `❌ Product ${index} (${url}): Failed - ${errorMessage}`);
          },
          
          // Progress updates
          onProgress: async (progress, index) => {
            // Save progress periodically
            await fs.writeFile(progressFilePath, JSON.stringify(progress, null, 2))
              .catch(err => console.error('Error saving progress:', err));
            
            // Log progress to the log file
            await appendToLog(logFilePath, `Progress: ${progress.percent}% (${progress.completed}/${progress.total}), Success: ${progress.success}, Failed: ${progress.failure}, Time elapsed: ${progress.elapsedSeconds}s`);
          },
          
          // No limit on products
          maxProducts: Infinity,
          
          // Delay between requests
          saveDelay: SAVE_DELAY
        };
        
        // Process products with concurrency
        console.log(`Processing ${productLinks.length} products with concurrency of ${CONCURRENCY}...`);
        
        const scrapedProducts = await adapter.processProductsWithConcurrency(
          browser, 
          productLinks,
          concurrencyOptions
        );
        
        // Make sure we have the most up-to-date collection of products
        if (scrapedProducts.length > allScrapedProducts.length) {
          // Commenting out debug message
          /* 
          console.log(`Note: processProductsWithConcurrency returned ${scrapedProducts.length} products, but we collected ${allScrapedProducts.length} through callbacks.`);
          console.log(`Using the larger collection for the final files.`);
          */
          
          // Final save of all products files using the largest collection
          await saveAllProductsFiles();
        } else {
          // Final save of all products files
          if (allScrapedProducts.length > lastSaveCount || lastSaveCount === 0) {
            await saveAllProductsFiles();
          }
        }
        
        // Final confirmation
        if (allScrapedProducts.length > 0) {
          console.log(`\n✅ Final all_products files saved with ${allScrapedProducts.length} products`);
          await appendToLog(logFilePath, `\n✅ Final all_products files saved with ${allScrapedProducts.length} products`);
        } else {
          console.log('\n❌ No products were successfully scraped');
          await appendToLog(logFilePath, '\n❌ No products were successfully scraped');
        }
        
        // Create a summary file
        const summary = {
          timestamp: new Date().toISOString(),
          category: testCategory.name,
          totalProductsFound: productLinks.length,
          productsProcessed: productLinks.length,
          successCount: allScrapedProducts.length,
          failureCount: productLinks.length - allScrapedProducts.length
        };
        
        const summaryPath = path.join(sessionDir, 'summary.json');
        await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
        console.log('\n--- Summary ---');
        console.log(summary);
        await appendToLog(logFilePath, '\n--- Summary ---');
        await appendToLog(logFilePath, JSON.stringify(summary, null, 2));
      } else {
        console.log('\n❌ No product links found, cannot proceed with product extraction');
        await appendToLog(logFilePath, '\nNo product links found, cannot proceed with product extraction');
      }
      
    } catch (error) {
      console.error('Error during category page processing:', error);
      await appendToLog(logFilePath, `Error during category page processing: ${error.message}`);
      
      // Commenting out detailed error saving
      /* 
      // Save error details
      await fs.writeFile(path.join(sessionDir, 'category-error.txt'), error.stack || error.toString());
      */
      
      // Close page if open
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
    }
    
  } catch (error) {
    console.error('Fatal error during scraping:', error);
    await appendToLog(logFilePath, `Fatal error: ${error.message}`);
    
    // Commenting out detailed error saving
    /* 
    await fs.writeFile(path.join(sessionDir, 'fatal-error.txt'), error.stack || error.toString());
    */
  } finally {
    // Close the browser
    if (browser) {
      await browser.close().catch(() => {});
      console.log('Browser closed. Scraping complete.');
      await appendToLog(logFilePath, 'Scraping complete. Browser closed.');
    }
  }
}

// Helper function to append to log file
async function appendToLog(filePath, message) {
  try {
    await fs.appendFile(filePath, message + '\n');
  } catch (error) {
    // Commenting out detailed error logging
    /* 
    console.error('Error writing to log file:', error);
    */
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
  
  // Handle pagination
  while (hasNextPage && currentPage < maxPages) {
    hasNextPage = await adapter.goToNextPage(page);
    if (hasNextPage) {
      currentPage++;
      console.log(`Moving to page ${currentPage}...`);
      
      // Extract products from the new page
      const newLinks = await adapter.extractProductLinksFromCategory(page, page.url());
      allLinks.push(...newLinks);
      console.log(`Page ${currentPage}: Found ${newLinks.length} products. Total: ${allLinks.length}`);
    }
  }
  
  // Remove duplicate links
  const uniqueLinks = [...new Set(allLinks)];
  console.log(`Found ${uniqueLinks.length} unique product links (removed ${allLinks.length - uniqueLinks.length} duplicates)`);
  
  return uniqueLinks;
}

// Run the scraper
test1stDibsScraper().catch(console.error); 