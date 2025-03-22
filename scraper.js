/**
 * Furniture Scraper Core Module
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import pLimit from 'p-limit';
import fs from 'fs/promises';
import path from 'path';
import { AdapterFactory } from './adapters/adapter-factory.js';

/**
 * The main scraper class
 */
export class FurnitureScraper {
  /**
   * Constructor
   * @param {Object} config - Configuration object
   */
  constructor(config = {}) {
    // Set configuration with defaults
    this.config = {
      retailer: config.retailer || 'IKEA',
      categoryUrl: config.categoryUrl || null,
      delayBetweenRequests: config.delayBetweenRequests || 1500,
      maxConcurrentRequests: config.maxConcurrentRequests || 2,
      cacheFile: config.cacheFile || 'crawled.json',
      headless: config.headless !== false, // Default to true
      country: config.country || 'ca',
      language: config.language || 'en',
      supabaseUrl: config.supabaseUrl,
      supabaseKey: config.supabaseKey
    };
    
    // Initialize rate limiter
    this.limit = pLimit(this.config.maxConcurrentRequests);
    
    // Create Supabase client if credentials are provided
    if (this.config.supabaseUrl && this.config.supabaseKey) {
      this.supabase = createClient(this.config.supabaseUrl, this.config.supabaseKey);
    }
    
    // Get the appropriate adapter
    try {
      this.adapter = AdapterFactory.getAdapter(this.config.retailer, {
        country: this.config.country,
        language: this.config.language
      });
    } catch (error) {
      throw new Error(`Failed to initialize adapter: ${error.message}`);
    }
  }
  
  /**
   * Random delay function to avoid detection
   * @returns {Promise} Promise that resolves after the delay
   */
  async randomDelay() {
    const jitter = Math.floor(Math.random() * 500);
    return new Promise(resolve => setTimeout(resolve, this.config.delayBetweenRequests + jitter));
  }
  
  /**
   * Load cache of previously crawled products
   * @returns {Promise<Set>} Set of previously crawled URLs
   */
  async loadCache() {
    try {
      const data = await fs.readFile(this.config.cacheFile, 'utf8');
      return new Set(JSON.parse(data));
    } catch (error) {
      return new Set();
    }
  }
  
  /**
   * Save cache of crawled products
   * @param {Set} cache - Set of crawled URLs
   * @returns {Promise} Promise that resolves when cache is saved
   */
  async saveCache(cache) {
    await fs.writeFile(this.config.cacheFile, JSON.stringify([...cache]), 'utf8');
  }
  
  /**
   * Extract all product links from a category page, including pagination
   * @param {Page} page - Playwright page object
   * @param {string} url - Category URL to scrape
   * @returns {Promise<Array<string>>} Array of product URLs
   */
  async getAllProductLinksFromCategory(page, url) {
    console.log(`Visiting category page: ${url}`);
    
    const productLinks = new Set();
    let hasNextPage = true;
    let currentPage = 1;
    
    while (hasNextPage) {
      console.log(`Processing page ${currentPage} of category...`);
      
      // Extract product links using the adapter
      const links = await this.adapter.extractProductLinksFromCategory(page, url);
      
      // Add links to the set
      links.forEach(link => productLinks.add(link));
      console.log(`Found ${links.length} products on page ${currentPage}. Total unique products: ${productLinks.size}`);
      
      // Use adapter to handle pagination
      hasNextPage = await this.adapter.goToNextPage(page);
      if (hasNextPage) {
        currentPage++;
        // Small delay between pagination
        await this.randomDelay();
      }
    }
    
    return [...productLinks];
  }
  
  /**
   * Extract product data from a product page
   * @param {Page} page - Playwright page object
   * @param {string} url - Product URL to scrape
   * @returns {Promise<Object|null>} Product data object or null if extraction failed
   */
  async extractProductData(page, url) {
    return this.adapter.extractProductData(page, url);
  }
  
  /**
   * Save product data to Supabase
   * @param {Object} productData - Product data to save
   * @returns {Promise<boolean>} True if save was successful, false otherwise
   */
  async saveToSupabase(productData) {
    if (!this.supabase) {
      console.error('Supabase client not initialized. Check your credentials.');
      return false;
    }
    
    // Transform data into standardized format using the adapter
    const transformedData = this.adapter.transformProductData(productData);
    
    if (!transformedData) {
      console.error('Failed to transform product data');
      return false;
    }
    
    try {
      // Debug the data being sent to Supabase
      console.log('Attempting to save data:', JSON.stringify(transformedData, null, 2));
      
      // Insert data into Supabase
      const { data, error } = await this.supabase.from('products').insert([transformedData]);
      
      if (error) {
        // More detailed error logging
        console.error('Error saving to Supabase:', error);
        console.error('Error code:', error.code);
        console.error('Error details:', error.details);
        console.error('Error hint:', error.hint);
        return false;
      }
      
      console.log(`Saved product: ${transformedData.name} (${transformedData.product_id})`);
      return true;
    } catch (error) {
      // Catch and log any unexpected errors
      console.error('Exception in saveToSupabase:', error);
      return false;
    }
  }
  
  /**
   * Run the scraper
   * @returns {Promise<Object>} Statistics about the scrape
   */
  async run() {
    console.log(`Starting ${this.adapter.getRetailerName()} furniture scraper...`);
    
    // Get category URL (either from config or from adapter)
    let categoryUrl = this.config.categoryUrl;
    if (!categoryUrl) {
      // Get the first category from the adapter if no specific category was provided
      const categories = this.adapter.getCategories();
      if (categories && categories.length > 0) {
        categoryUrl = categories[0].url;
      } else {
        throw new Error('No category URL specified and adapter did not provide default categories');
      }
    }
    
    console.log(`Target category URL: ${categoryUrl}`);
    
    // Load cache of previously crawled products
    const crawledCache = await this.loadCache();
    console.log(`Loaded cache with ${crawledCache.size} previously crawled products`);
    
    // Statistics
    const stats = {
      retailer: this.adapter.getRetailerName(),
      categoryUrl,
      startTime: new Date().toISOString(),
      totalProducts: 0,
      successCount: 0,
      errorCount: 0,
      skippedCount: 0,
      endTime: null
    };
    
    // Launch browser
    const browser = await chromium.launch({ headless: this.config.headless });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
    });
    
    try {
      // Create page
      const page = await context.newPage();
      
      // Get all product links from category
      const productLinks = await this.getAllProductLinksFromCategory(page, categoryUrl);
      stats.totalProducts = productLinks.length;
      console.log(`Found a total of ${stats.totalProducts} product links`);
      
      // Process each product link
      const promises = productLinks.map(url => this.limit(async () => {
        // Skip if already crawled
        if (crawledCache.has(url)) {
          console.log(`Skipping already crawled product: ${url}`);
          stats.skippedCount++;
          return;
        }
        
        try {
          // Create a new page for each product to avoid state conflicts
          const productPage = await context.newPage();
          
          // Extract product data
          const productData = await this.extractProductData(productPage, url);
          
          // Save to Supabase if data was successfully extracted
          if (productData) {
            const success = await this.saveToSupabase(productData);
            if (success) {
              stats.successCount++;
              crawledCache.add(url);
            } else {
              stats.errorCount++;
            }
          } else {
            stats.errorCount++;
          }
          
          // Close the product page
          await productPage.close();
          
          // Random delay between requests
          await this.randomDelay();
        } catch (error) {
          console.error(`Error processing ${url}:`, error.message);
          stats.errorCount++;
        }
      }));
      
      // Wait for all promises to resolve
      await Promise.all(promises);
      
      // Save updated cache
      await this.saveCache(crawledCache);
      
      // Update end time
      stats.endTime = new Date().toISOString();
      
      // Final stats
      console.log('\n--- Final Statistics ---');
      console.log(`✅ Successfully scraped and saved: ${stats.successCount} products`);
      console.log(`⚠️ Skipped (already crawled): ${stats.skippedCount} products`);
      console.log(`❌ Failed to process: ${stats.errorCount} products`);
      console.log(`Total products attempted: ${stats.totalProducts}`);
      
      return stats;
      
    } catch (error) {
      console.error('Error in scraper execution:', error);
      throw error;
    } finally {
      // Close browser
      await browser.close();
    }
  }
} 