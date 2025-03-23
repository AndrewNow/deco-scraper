// Test script for 1stDibs scraper
import { chromium } from 'playwright';
import { FirstDibsAdapter } from './adapters/retailers/firstdibs-adapter.js';
import fs from 'fs/promises';
import path from 'path';
import pLimit from 'p-limit';

const DEBUG_MODE = process.env.DEBUG === 'true';

// Configuration settings
const CONCURRENCY = 3; // Reduce concurrency to avoid being blocked
const PAGE_TIMEOUT = 60000; // Increase timeout to 60 seconds
const PROGRESS_INTERVAL = 5; // Save progress every 5 items
const MAX_PAGES_TO_SCRAPE = 2; // Limit to 2 pages initially to test
const NAVIGATION_RETRY_COUNT = 3; // Number of retries for navigation
const HUMAN_LIKE_DELAY_MIN = 3000; // Minimum delay between actions (3 seconds)
const HUMAN_LIKE_DELAY_MAX = 7000; // Maximum delay between actions (7 seconds)

// Helper function to add a random human-like delay
const addHumanLikeDelay = async () => {
  const delay = Math.floor(Math.random() * (HUMAN_LIKE_DELAY_MAX - HUMAN_LIKE_DELAY_MIN)) + HUMAN_LIKE_DELAY_MIN;
  console.log(`Adding human-like delay of ${delay/1000} seconds...`);
  await new Promise(resolve => setTimeout(resolve, delay));
};

async function test1stDibsScraper() {
  console.log('Starting 1stDibs scraper test with anti-block measures...');
  
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
  console.log(`Limited to ${MAX_PAGES_TO_SCRAPE} pages for initial testing`);

  // Launch browser with standard settings but show browser for debugging
  const browser = await chromium.launch({ 
    headless: false, // Show browser for debugging
    slowMo: 100, // Slow down actions by 100ms
    timeout: PAGE_TIMEOUT
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    // Add user gesture and other fingerprinting evasion
    hasTouch: false,
    isMobile: false,
    deviceScaleFactor: 1,
    javaScriptEnabled: true
  });
  
  // Initialize tracking variables
  let successCount = 0;
  let failureCount = 0;
  let browser_page = null;
  
  try {
    // Log basic info
    await appendToLog(logFilePath, `1stDibs Scraper Test - ${new Date().toISOString()}`);
    await appendToLog(logFilePath, `Category: ${testCategory.name} (${testCategory.url})`);
    
    // Step 1: Extract product links from the category page
    console.log('\n--- STEP 1: Extracting product links ---');
    await appendToLog(logFilePath, '\n--- STEP 1: Extracting product links ---');
    
    // Ensure page is fully loaded
    console.log('Waiting for page to be fully loaded...');
    
    // Create a new page for browsing categories
    browser_page = await context.newPage();
    
    try {
      // More conservative loading strategy
      await browser_page.goto(testCategory.url, { 
        waitUntil: 'domcontentloaded',
        timeout: PAGE_TIMEOUT 
      });
      
      // Wait for some key elements to be visible
      await browser_page.waitForSelector('h1', { timeout: 15000 }).catch(() => {
        console.log('Timeout waiting for H1, but continuing anyway');
      });
      
      // Add a human-like delay before taking any action
      await addHumanLikeDelay();
      
      // Take screenshots at key points
      const screenshotPath = path.join(sessionDir, 'debug-category-page.png');
      await browser_page.screenshot({ path: screenshotPath });
      console.log(`Saved screenshot to ${screenshotPath}`);
      
      // Extract product links from pages
      const productLinks = await extractProductLinks(adapter, browser_page, testCategory.url, MAX_PAGES_TO_SCRAPE, logFilePath);
      console.log(`Found a total of ${productLinks.length} product links across pages`);
      await appendToLog(logFilePath, `Found a total of ${productLinks.length} product links across pages`);
      
      // Save the list of product links to a file
      const linksFilePath = path.join(sessionDir, 'product-links.json');
      await fs.writeFile(linksFilePath, JSON.stringify(productLinks, null, 2));
      console.log(`Saved all product links to ${linksFilePath}`);
      
      // Close the category browsing page
      await browser_page.close();
      browser_page = null;
      
      // Process products - no limit but we're only getting 2 pages worth
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
          
          // Add a random delay before each product to appear more human-like
          await addHumanLikeDelay();
          
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
            await productPage.close();
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
      console.error('Error during product link extraction:', error);
      await appendToLog(logFilePath, `Error during product link extraction: ${error.message}`);
      await fs.writeFile(path.join(sessionDir, 'error.txt'), error.stack);
    }
    
  } catch (error) {
    console.error('Error during test:', error);
    await appendToLog(logFilePath, `Fatal error: ${error.message}`);
    await fs.writeFile(path.join(sessionDir, 'fatal-error.txt'), error.stack);
  } finally {
    // Clean up any open pages
    if (browser_page) {
      await browser_page.close().catch(() => {});
    }
    
    // Close the browser
    await browser.close().catch(() => {});
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
async function extractProductLinks(adapter, page, categoryUrl, maxPages = 2, logFilePath) {
  let allLinks = [];
  let currentPage = 1;
  let hasNextPage = true;
  
  // Try to get links from the first page with retries
  let initialLinkExtraction = false;
  let retryCount = 0;
  
  while (!initialLinkExtraction && retryCount < NAVIGATION_RETRY_COUNT) {
    try {
      // Initial extraction with retry logic
      console.log(`Extracting links from page ${currentPage} (attempt ${retryCount + 1})...`);
      await appendToLog(logFilePath, `Extracting links from page ${currentPage} (attempt ${retryCount + 1})...`);
      
      // Add a human-like delay
      await addHumanLikeDelay();
      
      const links = await adapter.extractProductLinksFromCategory(page, categoryUrl);
      
      if (links && links.length > 0) {
        allLinks.push(...links);
        console.log(`Page ${currentPage}: Found ${links.length} products. Total: ${allLinks.length}`);
        await appendToLog(logFilePath, `Page ${currentPage}: Found ${links.length} products. Total: ${allLinks.length}`);
        initialLinkExtraction = true;
      } else {
        console.log(`No links found on page ${currentPage}, retrying...`);
        retryCount++;
        
        // Try reloading the page
        await page.reload({ waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
        await addHumanLikeDelay();
      }
    } catch (error) {
      console.error(`Error extracting links from page ${currentPage}:`, error.message);
      await appendToLog(logFilePath, `Error extracting links from page ${currentPage}: ${error.message}`);
      retryCount++;
      
      if (retryCount < NAVIGATION_RETRY_COUNT) {
        console.log(`Retrying page ${currentPage} (attempt ${retryCount + 1})...`);
        await addHumanLikeDelay();
        
        // Try reloading the page
        await page.reload({ waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT }).catch(() => {});
      }
    }
  }
  
  if (!initialLinkExtraction) {
    console.error(`Failed to extract links from the first page after ${NAVIGATION_RETRY_COUNT} attempts`);
    await appendToLog(logFilePath, `Failed to extract links from the first page after ${NAVIGATION_RETRY_COUNT} attempts`);
    return allLinks;
  }
  
  // Handle pagination with retry logic
  while (hasNextPage && currentPage < maxPages) {
    console.log(`Attempting to navigate to page ${currentPage + 1}...`);
    await appendToLog(logFilePath, `Attempting to navigate to page ${currentPage + 1}...`);
    
    // Add a human-like delay before pagination
    await addHumanLikeDelay();
    
    // Try to navigate to the next page with retries
    let pageNavigationSuccess = false;
    let navigationRetryCount = 0;
    
    while (!pageNavigationSuccess && navigationRetryCount < NAVIGATION_RETRY_COUNT) {
      try {
        hasNextPage = await adapter.goToNextPage(page);
        
        if (hasNextPage) {
          currentPage++;
          console.log(`Successfully moved to page ${currentPage}`);
          await appendToLog(logFilePath, `Successfully moved to page ${currentPage}`);
          pageNavigationSuccess = true;
          
          // Add a human-like delay after navigation
          await addHumanLikeDelay();
          
          // Extract products from the new page
          const newLinks = await adapter.extractProductLinksFromCategory(page, page.url());
          
          if (newLinks && newLinks.length > 0) {
            allLinks.push(...newLinks);
            console.log(`Page ${currentPage}: Found ${newLinks.length} products. Total: ${allLinks.length}`);
            await appendToLog(logFilePath, `Page ${currentPage}: Found ${newLinks.length} products. Total: ${allLinks.length}`);
          } else {
            console.log(`No links found on page ${currentPage}`);
            await appendToLog(logFilePath, `No links found on page ${currentPage}`);
          }
        } else {
          console.log(`No more pages available after page ${currentPage}`);
          await appendToLog(logFilePath, `No more pages available after page ${currentPage}`);
          break;
        }
      } catch (error) {
        console.error(`Error navigating to page ${currentPage + 1}:`, error.message);
        await appendToLog(logFilePath, `Error navigating to page ${currentPage + 1}: ${error.message}`);
        navigationRetryCount++;
        
        if (navigationRetryCount < NAVIGATION_RETRY_COUNT) {
          console.log(`Retrying navigation to page ${currentPage + 1} (attempt ${navigationRetryCount + 1})...`);
          await addHumanLikeDelay();
        } else {
          console.log(`Failed to navigate to page ${currentPage + 1} after ${NAVIGATION_RETRY_COUNT} attempts`);
          hasNextPage = false;
        }
      }
    }
  }
  
  // Remove any duplicate URLs
  const uniqueLinks = [...new Set(allLinks)];
  console.log(`Found ${uniqueLinks.length} unique product links (removed ${allLinks.length - uniqueLinks.length} duplicates)`);
  await appendToLog(logFilePath, `Found ${uniqueLinks.length} unique product links (removed ${allLinks.length - uniqueLinks.length} duplicates)`);
  
  return uniqueLinks;
}

// Run the test
test1stDibsScraper().catch(console.error); 