// Test script for 1stDibs scraper
import { chromium } from 'playwright';
import { FirstDibsAdapter } from './adapters/retailers/firstdibs-adapter.js';
import fs from 'fs/promises';
import path from 'path';

const DEBUG_MODE = process.env.DEBUG === 'true';

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
  
  // Create a log file for this session
  const logFilePath = path.join(sessionDir, 'scrape-log.txt');
  
  // Get default categories
  const categories = adapter.getCategories();
  console.log('Available categories:');
  categories.forEach((cat, i) => console.log(`  ${i+1}. ${cat.name}: ${cat.url}`));
  
  // Select the first category for testing
  const testCategory = categories[0];
  console.log(`\nTesting with category: ${testCategory.name} (${testCategory.url})`);
  
  // Launch browser
  const browser = await chromium.launch({ headless: !DEBUG_MODE });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    hasTouch: false,
    isMobile: false,
    deviceScaleFactor: 1,
    javaScriptEnabled: true
  });
  const page = await context.newPage();
  
  // Track results
  const scrapedProducts = [];
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
    await page.waitForTimeout(5000); // Additional wait for dynamic content
    
    // Take screenshots at key points
    await page.screenshot({ path: path.join(sessionDir, 'debug-category-page.png') });
    
    // Increase maxPages to get more products (or set it to a very high number to get all)
    const productLinks = await extractProductLinks(adapter, page, testCategory.url, 3); // Get 3 pages worth of products
    console.log(`Found ${productLinks.length} product links`);
    await appendToLog(logFilePath, `Found ${productLinks.length} product links`);
    
    // Save the list of product links to a file
    const linksFilePath = path.join(sessionDir, 'product-links.json');
    await fs.writeFile(linksFilePath, JSON.stringify(productLinks, null, 2));
    console.log(`Saved all product links to ${linksFilePath}`);
    
    // Process all product links (no limit)
    const testProducts = productLinks;
    console.log(`Processing all ${testProducts.length} products`);
    await appendToLog(logFilePath, `Processing all ${testProducts.length} products`);
    
    // Step 2: Extract product data for each link
    console.log('\n--- STEP 2: Extracting product details ---');
    await appendToLog(logFilePath, '\n--- STEP 2: Extracting product details ---');
    
    // Create a directory for product data
    const productsDir = path.join(sessionDir, 'products');
    await fs.mkdir(productsDir, { recursive: true });
    
    for (let i = 0; i < testProducts.length; i++) {
      const url = testProducts[i];
      console.log(`\nProcessing product ${i+1}/${testProducts.length}: ${url}`);
      await appendToLog(logFilePath, `\nProcessing product ${i+1}/${testProducts.length}: ${url}`);
      
      try {
        const productData = await adapter.extractProductData(page, url);
        if (productData) {
          console.log('✅ Successfully extracted raw product data');
          await appendToLog(logFilePath, '✅ Successfully extracted raw product data');
          
          // Transform the data to standardized format
          const transformedData = adapter.transformProductData(productData);
          if (transformedData) {
            console.log('✅ Successfully transformed product data');
            await appendToLog(logFilePath, '✅ Successfully transformed product data');
            
            // Add to our collection
            scrapedProducts.push(transformedData);
            successCount++;
            
            // Create a simple filename for the product
            const productFilename = `product_${i+1}.json`;
            const productPath = path.join(productsDir, productFilename);
            await fs.writeFile(productPath, JSON.stringify(transformedData, null, 2));
            console.log(`✅ Saved product data to ${productFilename}`);
            await appendToLog(logFilePath, `✅ Saved product data to ${productFilename}`);
          } else {
            console.log('❌ Failed to transform product data');
            await appendToLog(logFilePath, '❌ Failed to transform product data');
            failureCount++;
          }
        } else {
          console.log('❌ Failed to extract product data');
          await appendToLog(logFilePath, '❌ Failed to extract product data');
          failureCount++;
        }
      } catch (productError) {
        console.error('Error processing product:', productError);
        await appendToLog(logFilePath, `❌ Error: ${productError.message}`);
        failureCount++;
      }
      
      // Wait between requests to be respectful
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Periodically save the results in case of interruption
      if (i > 0 && i % 10 === 0) {
        const progressPath = path.join(sessionDir, 'progress_all_products.json');
        await fs.writeFile(progressPath, JSON.stringify(scrapedProducts, null, 2));
        console.log(`Saved progress after ${i} products`);
      }
    }
    
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
      successCount,
      failureCount,
      totalSaved: scrapedProducts.length
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
  
  // Handle pagination (now with no practical limit - will go until no more pages or maxPages is reached)
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
  
  return allLinks;
}

// Run the test
test1stDibsScraper().catch(console.error); 