// Stable script for 1stDibs scraper
import { chromium } from 'playwright';
import { FirstDibsAdapter } from './adapters/retailers/firstdibs-adapter.js';
import fs from 'fs/promises';
import path from 'path';

// Configuration
const DEBUG_MODE = process.env.DEBUG === 'true';
const PAGE_TIMEOUT = 60000; // 60 seconds
const NAVIGATION_TIMEOUT = 45000; // 45 seconds
const WAIT_BETWEEN_PRODUCTS = 5000; // 5 seconds between products
const MAX_PRODUCTS_TO_SCRAPE = 5; // Limit for testing

/**
 * Creates directories for the scraper session
 */
async function setupDirectories() {
  // Create main results directory if it doesn't exist
  const mainResultsDir = './results';
  await fs.mkdir(mainResultsDir, { recursive: true });
  console.log(`Created or verified main results directory: ${mainResultsDir}`);
  
  // Create a timestamped directory for this scraping session
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sessionDir = path.join(mainResultsDir, `scrape-${timestamp}`);
  await fs.mkdir(sessionDir, { recursive: true });
  console.log(`Created session directory: ${sessionDir}`);
  
  // Create a products directory within the session directory
  const productsDir = path.join(sessionDir, 'products');
  await fs.mkdir(productsDir, { recursive: true });
  console.log(`Created products directory: ${productsDir}`);
  
  return {
    mainResultsDir,
    sessionDir,
    productsDir,
    timestamp
  };
}

/**
 * Main scraper function
 */
async function runStableScraper() {
  console.log('Starting 1stDibs stable scraper...');
  let browser = null;
  let successCount = 0;
  let failureCount = 0;
  
  try {
    // Create directories
    const { sessionDir, productsDir } = await setupDirectories();
    
    // Create log file
    const logFilePath = path.join(sessionDir, 'scrape-log.txt');
    await appendToLog(logFilePath, `1stDibs Stable Scraper - ${new Date().toISOString()}`);
    
    // Initialize adapter
    const adapter = new FirstDibsAdapter();
    console.log(`Initialized adapter for: ${adapter.getRetailerName()}`);
    await appendToLog(logFilePath, `Retailer: ${adapter.getRetailerName()}`);
    
    // Get categories
    const categories = adapter.getCategories();
    console.log('Available categories:');
    categories.forEach((cat, i) => console.log(`  ${i+1}. ${cat.name}: ${cat.url}`));
    
    // Select the first category
    const selectedCategory = categories[0];
    console.log(`\nSelected category: ${selectedCategory.name} (${selectedCategory.url})`);
    await appendToLog(logFilePath, `Category: ${selectedCategory.name} (${selectedCategory.url})`);
    
    // Launch browser with default context
    browser = await chromium.launch({ 
      headless: false, // Set to false to see what's happening
      timeout: PAGE_TIMEOUT
    });
    
    // Create main context for category browsing
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      hasTouch: false,
      isMobile: false,
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
      timeout: PAGE_TIMEOUT
    });
    
    const page = await context.newPage();
    
    // Step 1: Extract product links from category page
    console.log('\n--- STEP 1: Extracting product links ---');
    await appendToLog(logFilePath, '\n--- STEP 1: Extracting product links ---');
    
    console.log(`Navigating to ${selectedCategory.url}...`);
    await page.goto(selectedCategory.url, { 
      waitUntil: 'domcontentloaded', 
      timeout: NAVIGATION_TIMEOUT 
    });
    
    // Wait for page to load
    await page.waitForSelector('h1', { timeout: 10000 }).catch(() => {
      console.log('Timeout waiting for H1, but continuing anyway');
    });
    
    // Take screenshot
    await page.screenshot({ path: path.join(sessionDir, 'category-page.png') });
    
    // Extract product links
    console.log('Extracting product links...');
    const allProductLinks = await adapter.extractProductLinksFromCategory(page, selectedCategory.url);
    console.log(`Found ${allProductLinks.length} product links`);
    await appendToLog(logFilePath, `Found ${allProductLinks.length} product links`);
    
    // Save the full list of links
    const linksFilePath = path.join(sessionDir, 'product-links.json');
    await fs.writeFile(linksFilePath, JSON.stringify(allProductLinks, null, 2));
    console.log(`Saved all product links to ${linksFilePath}`);
    
    // Limit the number of products to process
    const productLinksToProcess = allProductLinks.slice(0, MAX_PRODUCTS_TO_SCRAPE);
    console.log(`\nProcessing ${productLinksToProcess.length} products (limited for testing)`);
    await appendToLog(logFilePath, `Processing ${productLinksToProcess.length} products`);
    
    // Collection for successful products
    const scrapedProducts = [];
    
    // Step 2: Process each product sequentially (more stable)
    console.log('\n--- STEP 2: Processing products sequentially ---');
    await appendToLog(logFilePath, '\n--- STEP 2: Processing products sequentially ---');
    
    // Close the category page to free resources
    await page.close();
    
    // Sequential processing
    for (let i = 0; i < productLinksToProcess.length; i++) {
      const productUrl = productLinksToProcess[i];
      const productIndex = i + 1;
      
      console.log(`\nProcessing product ${productIndex}/${productLinksToProcess.length}: ${productUrl}`);
      await appendToLog(logFilePath, `Processing product ${productIndex}/${productLinksToProcess.length}: ${productUrl}`);
      
      try {
        // Create a new page for each product
        const productPage = await context.newPage();
        
        // Set shorter timeout for this specific page
        productPage.setDefaultTimeout(NAVIGATION_TIMEOUT);
        
        // Extract product data
        const productData = await adapter.extractProductData(productPage, productUrl);
        
        // Close the page when done
        await productPage.close();
        
        if (productData) {
          console.log(`✅ Product ${productIndex}: Successfully extracted raw product data`);
          await appendToLog(logFilePath, `✅ Product ${productIndex}: Successfully extracted raw product data`);
          
          // Transform the data
          const transformedData = adapter.transformProductData(productData);
          
          if (transformedData) {
            console.log(`✅ Product ${productIndex}: Successfully transformed product data`);
            await appendToLog(logFilePath, `✅ Product ${productIndex}: Successfully transformed product data`);
            
            // Save individual product file
            const productFilename = `product_${productIndex}.json`;
            const productPath = path.join(productsDir, productFilename);
            await fs.writeFile(productPath, JSON.stringify(transformedData, null, 2));
            console.log(`✅ Product ${productIndex}: Saved to ${productFilename}`);
            
            // Add to collection
            scrapedProducts.push(transformedData);
            successCount++;
          } else {
            console.log(`❌ Product ${productIndex}: Failed to transform product data`);
            await appendToLog(logFilePath, `❌ Product ${productIndex}: Failed to transform product data`);
            failureCount++;
          }
        } else {
          console.log(`❌ Product ${productIndex}: Failed to extract product data`);
          await appendToLog(logFilePath, `❌ Product ${productIndex}: Failed to extract product data`);
          failureCount++;
        }
      } catch (error) {
        console.error(`Error processing product ${productIndex}:`, error.message);
        await appendToLog(logFilePath, `❌ Product ${productIndex} Error: ${error.message}`);
        failureCount++;
      }
      
      // Add delay between products
      if (i < productLinksToProcess.length - 1) {
        const delay = WAIT_BETWEEN_PRODUCTS;
        console.log(`Waiting ${delay/1000} seconds before next product...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // Save all successful results to a single file
    if (scrapedProducts.length > 0) {
      const allResultsPath = path.join(sessionDir, 'all_products.json');
      await fs.writeFile(allResultsPath, JSON.stringify(scrapedProducts, null, 2));
      console.log(`\n✅ Saved all ${scrapedProducts.length} products to ${allResultsPath}`);
      await appendToLog(logFilePath, `\n✅ Saved all ${scrapedProducts.length} products to ${allResultsPath}`);
    } else {
      console.log('\n❌ No products were successfully scraped');
      await appendToLog(logFilePath, '\n❌ No products were successfully scraped');
    }
    
    // Create summary
    const summary = {
      timestamp: new Date().toISOString(),
      category: selectedCategory.name,
      totalProductsFound: allProductLinks.length,
      productsProcessed: productLinksToProcess.length,
      successCount: successCount,
      failureCount: failureCount
    };
    
    // Save summary
    const summaryPath = path.join(sessionDir, 'summary.json');
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
    
    console.log('\n--- Scraping completed ---');
    console.log('Summary:', summary);
    await appendToLog(logFilePath, '\n--- Scraping completed ---');
    await appendToLog(logFilePath, `Summary: ${JSON.stringify(summary, null, 2)}`);
    
  } catch (error) {
    console.error('Fatal error during scraping:', error);
  } finally {
    // Ensure browser is closed
    if (browser) {
      await browser.close();
      console.log('Browser closed.');
    }
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

// Run the scraper
runStableScraper().catch(error => {
  console.error('Unhandled error in scraper:', error);
  process.exit(1);
}); 