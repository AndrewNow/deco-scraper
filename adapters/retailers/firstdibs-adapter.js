import { BaseAdapter } from '../base-adapter.js';
import pLimit from 'p-limit';

/**
 * 1stDibs Adapter
 * 
 * This adapter handles scraping 1stDibs' website.
 */
export class FirstDibsAdapter extends BaseAdapter {
  constructor(country = 'us', language = 'en', concurrency = 3) {
    super();
    this.country = country;
    this.language = language;
    this.baseUrl = `https://www.1stdibs.com`;
    // Concurrency settings
    this.concurrency = concurrency;
  }

  /**
   * Get retailer name
   * @returns {string} The retailer name
   */
  getRetailerName() {
    return '1stDibs';
  }

  /**
   * Get default categories to scrape
   * @returns {Array<Object>} Array of category objects with name and url
   */
  getCategories() {
    return [
      {
        name: 'Seating',
        url: `${this.baseUrl}/furniture/seating/`
      },
      // {
      //   name: 'Chairs',
      //   url: `${this.baseUrl}/furniture/seating/chairs/`
      // },
      // {
      //   name: 'Tables',
      //   url: `${this.baseUrl}/furniture/tables/`
      // },
      // {
      //   name: 'Storage',
      //   url: `${this.baseUrl}/furniture/storage-case-pieces/`
      // },
      // {
      //   name: 'Lighting',
      //   url: `${this.baseUrl}/furniture/lighting/`
      // },
      // {
      //   name: 'Outdoor',
      //   url: `${this.baseUrl}/furniture/outdoor-furniture/`
      // }
    ];
  }
  
  /**
   * Delay helper to avoid rate limiting
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   */
  async delay(ms = this.retryDelay) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Retry a function multiple times before giving up
   * @param {Function} fn - Function to retry
   * @param {number} retries - Number of retries
   * @param {number} delayMs - Delay between retries
   * @returns {Promise<any>} - Result of the function
   */
  async retry(fn, retries = this.retryAttempts, delayMs = this.retryDelay) {
    try {
      return await fn();
    } catch (error) {
      if (retries <= 1) throw error;
      console.log(`Retry attempt, ${retries-1} remaining`);
      await this.delay(delayMs);
      return this.retry(fn, retries - 1, delayMs);
    }
  }
  
  /**
   * Simulate human-like scrolling behavior
   * @param {Page} page - Playwright page
   */
  async simulateHumanScrolling(page) {
    console.log('Simulating human-like scrolling...');
    
    // Get page height
    const pageHeight = await page.evaluate(() => document.body.scrollHeight);
    
    // Scroll down in chunks with random delays
    let currentPosition = 0;
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    
    while (currentPosition < pageHeight) {
      // Random scroll amount between 100 and viewport height
      const scrollAmount = Math.floor(Math.random() * (viewportHeight - 100)) + 100;
      currentPosition += scrollAmount;
      
      await page.evaluate((scrollPos) => {
        window.scrollTo({
          top: scrollPos,
          behavior: 'smooth'
        });
      }, currentPosition);
      
      // Random delay between 300ms and 1000ms
      const randomDelay = Math.floor(Math.random() * 700) + 300;
      await this.delay(randomDelay);
    }
    
    // Scroll back up a bit (as humans often do)
    await page.evaluate(() => {
      window.scrollTo({
        top: window.scrollY - 400,
        behavior: 'smooth'
      });
    });
    
    await this.delay(500);
  }

  /**
   * Extract product links from a category page
   * @param {Page} page - Playwright page object
   * @param {string} url - The category URL to scrape
   * @returns {Promise<Array<string>>} Array of product URLs
   */
  async extractProductLinksFromCategory(page, url) {
    console.log(`Navigating to category page: ${url}`);
    
    try {
      // More conservative loading strategy
      await page.goto(url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 60000 // 60 seconds timeout
      });
      
      // Wait for essential page elements with a decent timeout
      await this.retry(async () => {
        await page.waitForSelector('h1', { timeout: 15000 })
          .catch(() => console.log('Timeout waiting for H1, but continuing anyway'));
      });
      
      console.log('Page loaded, extracting product links...');
      
      // Debug: Log the page title to confirm we're on the right page
      const title = await page.title();
      console.log(`Page title: ${title}`);
      
      // Simulate human-like scrolling behavior
      await this.simulateHumanScrolling(page);
      
      // Try several different selectors that might be used on 1stDibs
      let productLinks = [];
      
      // 1. Try data-tn attribute approach first (most specific)
      try {
        const cards = await page.$$('div[data-tn="product-card"]');
        console.log(`Found ${cards.length} product cards with [data-tn="product-card"]`);
        
        if (cards.length > 0) {
          productLinks = await page.$$eval('div[data-tn="product-card"] a[href*="/furniture/"]', links => 
            links.map(link => link.href)
          );
          
          if (productLinks.length > 0) {
            console.log(`Found ${productLinks.length} products using div[data-tn="product-card"] selector`);
            return productLinks;
          }
        }
      } catch (error) {
        console.error('Error with product card selector:', error.message);
      }
      
      // 2. Try a more general approach with href pattern matching
      try {
        console.log('Trying href pattern matching approach...');
        const furnitureLinks = await page.$$eval('a[href*="/furniture/"][href*="/id-"]', links => 
          links.map(link => link.href)
        );
        
        if (furnitureLinks.length > 0) {
          console.log(`Found ${furnitureLinks.length} products using href pattern matching`);
          return furnitureLinks;
        }
      } catch (error) {
        console.error('Error with furniture links selector:', error.message);
      }
      
      // 3. Try product grid approach
      try {
        console.log('Trying product grid approach...');
        const gridItems = await page.$$('.grid-item a[href*="/id-"]');
        console.log(`Found ${gridItems.length} grid items`);
        
        if (gridItems.length > 0) {
          const gridLinks = await page.$$eval('.grid-item a[href*="/id-"]', links => 
            links.map(link => link.href)
          );
          
          if (gridLinks.length > 0) {
            console.log(`Found ${gridLinks.length} products using grid-item selector`);
            return gridLinks;
          }
        }
      } catch (error) {
        console.error('Error with grid-item selector:', error.message);
      }
      
      // 4. Most general approach - try to find any links that might be product links
      console.log('Trying most general selector approach...');
      
      try {
        // Look for links that match patterns typically found in product URLs
        const potentialProductLinks = await page.$$eval('a', links => 
          links.filter(link => {
            const href = link.href.toLowerCase();
            return href.includes('/id-') && href.includes('/furniture/');
          }).map(link => link.href)
        );
        
        console.log(`Found ${potentialProductLinks.length} potential product links by filtering all links`);
        
        if (potentialProductLinks.length > 0) {
          return potentialProductLinks;
        }
      } catch (error) {
        console.error('Error with general link selector:', error.message);
      }
      
      // If all else fails, log the HTML structure for manual inspection
      console.log('No product links found. Logging page structure for debugging...');
      const bodyHTML = await page.evaluate(() => document.body.innerHTML.substring(0, 5000)); // First 5000 chars
      console.log('Page HTML preview:', bodyHTML.substring(0, 500) + '...');
      
      return [];
      
    } catch (error) {
      console.error(`Error navigating to category page ${url}:`, error.message);
      return [];
    }
  }

  /**
   * Handle pagination for a category page
   * @param {Page} page - Playwright page object
   * @returns {Promise<boolean>} True if there's a next page, false otherwise
   */
  async goToNextPage(page) {
    console.log('Checking for pagination elements...');
    
    try {
      // First approach: Look for a "Next" button
      const nextButton = await this.retry(async () => {
        return await page.$('[data-tn="page-forward"]');
      });
      
      if (nextButton) {
        const isVisible = await nextButton.isVisible();
        console.log(`Found "Next page" button (data-tn="page-forward"), visible: ${isVisible}`);
        
        if (isVisible) {
          console.log('Clicking "Next page" button...');
          
          // Scroll to the button first (as a human would)
          await nextButton.scrollIntoViewIfNeeded();
          await this.delay(1000);
          
          // Click with retry logic
          await this.retry(async () => {
            await nextButton.click();
            // More conservative wait strategy
            await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
            // Wait for an essential element to confirm page changed
            await page.waitForSelector('h1', { timeout: 15000 })
              .catch(() => console.log('Timeout waiting for H1 on next page, but continuing'));
          });
          
          // Add additional delay to allow dynamic content to load
          await this.delay(2000);
          
          // Verify the page actually changed
          const currentUrl = page.url();
          console.log(`Page after navigation: ${currentUrl}`);
          
          return true;
        }
      }
      
      // Second approach: Look for "Load More" button
      const loadMoreButtons = await page.$$('button:has-text("Load More"), button:has-text("load more")');
      const loadMoreButton = loadMoreButtons.length > 0 ? loadMoreButtons[0] : null;
      
      if (loadMoreButton && await loadMoreButton.isVisible()) {
        console.log('Found "Load More" button, clicking it...');
        
        // Get current product count before clicking
        const currentProductCount = await page.$$eval('a[href*="/id-"]', items => items.length);
        
        // Scroll to the button first
        await loadMoreButton.scrollIntoViewIfNeeded();
        await this.delay(1000);
        
        // Click the button with retry
        let clickSuccessful = false;
        
        await this.retry(async () => {
          await loadMoreButton.click();
          
          // Wait for new content to load
          await this.delay(3000);
          
          // Check if more products loaded
          const newProductCount = await page.$$eval('a[href*="/id-"]', items => items.length);
          console.log(`Product count before: ${currentProductCount}, after: ${newProductCount}`);
          
          if (newProductCount > currentProductCount) {
            clickSuccessful = true;
          } else {
            throw new Error('No new products loaded after clicking Load More');
          }
        }).catch(err => {
          console.log(`Load More button failed: ${err.message}`);
          clickSuccessful = false;
        });
        
        return clickSuccessful;
      }
      
      // Additional approach: Check for any pagination links with numbers
      const paginationLinks = await page.$$('a[href*="page="], .pagination a');
      
      if (paginationLinks.length > 0) {
        console.log(`Found ${paginationLinks.length} pagination links`);
        
        // Try to find the active/current page and click the next one
        const currentPageElem = await page.$('.pagination .active, .pagination .current');
        
        if (currentPageElem) {
          const currentPageText = await currentPageElem.textContent();
          const currentPageNum = parseInt(currentPageText.trim(), 10);
          console.log(`Current page appears to be: ${currentPageNum}`);
          
          // Look for the next page number
          const nextPageElem = await page.$(`.pagination a:has-text("${currentPageNum + 1}")`);
          
          if (nextPageElem) {
            console.log(`Found link to page ${currentPageNum + 1}, clicking it...`);
            
            await nextPageElem.scrollIntoViewIfNeeded();
            await this.delay(1000);
            
            await this.retry(async () => {
              await nextPageElem.click();
              await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
            });
            
            return true;
          }
        }
      }
      
      console.log('No pagination elements found, reached end of products');
      return false;
      
    } catch (error) {
      console.error('Error during pagination:', error.message);
      return false;
    }
  }

  /**
   * Extract product data from a product page
   * @param {Page} page - Playwright page object
   * @param {string} url - The product URL to scrape
   * @returns {Promise<Object|null>} Product data object or null if extraction failed
   */
  async extractProductData(page, url) {
    console.log(`Visiting product page: ${url}`);
    
    try {
      // Use a more conservative loading strategy
      await this.retry(async () => {
        await page.goto(url, { 
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });
      });
      
      // Wait for the page title to be visible (indicates basic page load)
      await this.retry(async () => {
        await page.waitForSelector('h1', { timeout: 15000 })
          .catch(() => console.log('Could not find H1 element, but continuing anyway'));
      });
      
      // Simulate human-like scrolling
      await this.simulateHumanScrolling(page);
      
      // Get product URL slug/ID
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const productIdMatch = url.match(/\/id-([^\/]+)/);
      const productId = productIdMatch ? productIdMatch[1] : pathParts[pathParts.length - 1];
      const slug = pathParts[pathParts.length - 1] || productId;
      
      // 1. Extract the first image URL using the specific selector
      console.log('Extracting first image URL...');
      
      // Let's use retry logic for image extraction
      const firstImageUrl = await this.retry(async () => {
        // Try multiple selectors with fallbacks
        try {
          const mainImage = await page.$eval('[data-tn="pdp-image-carousel-image-1"] figure picture img', img => img.src);
          return mainImage;
        } catch (error) {
          console.log('Primary image selector failed, trying fallback 1...');
          try {
            const fallback1 = await page.$eval('[data-tn="pdp-image-carousel-image-1"] img', img => img.src);
            return fallback1;
          } catch (error) {
            console.log('Fallback 1 failed, trying fallback 2...');
            try {
              const fallback2 = await page.$eval('img[data-tn="product-image"]', img => img.src);
              return fallback2;
            } catch (error) {
              console.log('Fallback 2 failed, trying fallback 3...');
              try {
                const fallback3 = await page.$eval('div[data-tn="product-gallery"] img', img => img.src);
                return fallback3;
              } catch (error) {
                console.log('All image selectors failed');
                // General fallback: any large image on the page
                const anyImage = await page.$eval('img[src*="width="]', img => img.src)
                  .catch(() => null);
                return anyImage;
              }
            }
          }
        }
      }).catch(() => null);
      
      console.log(`Image URL found: ${firstImageUrl || 'None'}`);
      
      // 2. Extract basic product details first
      console.log('Extracting basic product details...');
      
      // Get name with retry
      const name = await this.retry(async () => {
        return await page.$eval('h1', el => el.textContent.trim())
          .catch(() => 'Unknown Product');
      });
      
      // Get price with retry
      const price = await this.retry(async () => {
        return await page.$eval('[data-tn="price-amount"]', el => el.textContent.trim())
          .catch(async () => {
            // Fallback price selector
            return await page.$eval('.price, .product-price', el => el.textContent.trim())
              .catch(() => 'Price not available');
          });
      });
      
      // 3. Extract the item details section
      console.log('Extracting item details section...');
      
      // Try to expand details if there's a "Read More" button
      try {
        const readMoreButton = await page.$('[data-tn="read-more"]');
        
        if (readMoreButton) {
          console.log('Found "Read More" button, clicking to expand details...');
          await readMoreButton.scrollIntoViewIfNeeded();
          await this.delay(500);
          await readMoreButton.click();
          await this.delay(1500); // Wait for expansion animation
        }
      } catch (error) {
        console.log('Error clicking Read More button:', error.message);
      }
      
      // Create an object to hold all the detailed specifications
      const specifications = {};
      
      // Extract specifications using the specific data attributes from the expanding area
      console.log('Extracting specifications from expanding area...');
      
      try {
        // 1. Extract Dimensions
        const dimensions = {};
        
        // Get height
        const height = await page.$eval('[data-tn="pdp-spec-detail-height"] ._57a9be25', el => el.textContent.trim())
          .catch(() => null);
        if (height) dimensions.height = height;
        
        // Get width
        const width = await page.$eval('[data-tn="pdp-spec-detail-width"] ._57a9be25', el => el.textContent.trim())
          .catch(() => null);
        if (width) dimensions.width = width;
        
        // Get depth
        const depth = await page.$eval('[data-tn="pdp-spec-detail-depth"] ._57a9be25', el => el.textContent.trim())
          .catch(() => null);
        if (depth) dimensions.depth = depth;
        
        // Get seat height (if available)
        const seatHeight = await page.$eval('[data-tn="pdp-spec-detail-secondaryHeight"] ._57a9be25', el => el.textContent.trim())
          .catch(() => null);
        if (seatHeight) dimensions.seatHeight = seatHeight;
        
        if (Object.keys(dimensions).length > 0) {
          specifications.dimensions = dimensions;
          console.log('  Found dimensions:', dimensions);
        }
        
        // 2. Extract Style
        const style = await page.$eval('[data-tn="pdp-spec-style"] [data-tn="pdp-spec-detail-style"]', el => el.textContent.trim())
          .catch(() => null);
        if (style) {
          specifications.style = style;
          console.log('  Found style:', style);
        }
        
        // 3. Extract Materials
        const materialsElements = await page.$$('[data-tn="pdp-spec-detail-material"] ._57a9be25');
        if (materialsElements.length > 0) {
          const materials = [];
          for (const el of materialsElements) {
            const material = await el.evaluate(node => node.textContent.trim().replace(/,$/,''));
            materials.push(material);
          }
          specifications.materials = materials;
          console.log('  Found materials:', materials);
        }
        
        // 4. Extract Place of Origin
        const origin = await page.$eval('[data-tn="pdp-spec-place-of-origin"] [data-tn="pdp-spec-detail-origin"]', el => el.textContent.trim())
          .catch(() => null);
        if (origin) {
          specifications.origin = origin;
          console.log('  Found origin:', origin);
        }
        
        // 5. Extract Period
        const period = await page.$eval('[data-tn="pdp-spec-period"] [data-tn="pdp-spec-detail-period"]', el => el.textContent.trim())
          .catch(() => null);
        if (period) {
          specifications.period = period;
          console.log('  Found period:', period);
        }
        
        // 6. Extract Date of Manufacture
        const dateOfManufacture = await page.$eval('[data-tn="pdp-spec-date-of-manufacture"] [data-tn="pdp-spec-detail-dateOfManufacture"]', el => el.textContent.trim())
          .catch(() => null);
        if (dateOfManufacture) {
          specifications.dateOfManufacture = dateOfManufacture;
          console.log('  Found date of manufacture:', dateOfManufacture);
        }
        
        // 7. Extract Condition
        const condition = await page.$eval('[data-tn="pdp-spec-detail-condition"]', el => el.textContent.trim())
          .catch(() => null);
        const conditionDetails = await page.$eval('[data-tn="pdp-spec-detail-conditionDetails"]', el => el.textContent.trim())
          .catch(() => null);
        
        if (condition || conditionDetails) {
          specifications.condition = {
            rating: condition || null,
            details: conditionDetails || null
          };
          console.log('  Found condition:', specifications.condition);
        }
        
        // 8. Extract Seller Location
        const sellerLocation = await page.$eval('[data-tn="pdp-spec-detail-sellerLocation"]', el => el.textContent.trim())
          .catch(() => null);
        if (sellerLocation) {
          specifications.sellerLocation = sellerLocation;
          console.log('  Found seller location:', sellerLocation);
        }
        
        // 9. Extract Reference Number
        const referenceNumber = await page.$eval('[data-tn="pdp-spec-detail-referenceNumber"]', el => el.textContent.trim())
          .catch(() => null);
        if (referenceNumber) {
          specifications.referenceNumber = referenceNumber;
          console.log('  Found reference number:', referenceNumber);
        }
        
        // 10. Extract the full raw HTML of the expanding area for completeness
        const expandingAreaHTML = await page.$eval('[data-tn="expanding-area"]', el => el.outerHTML)
          .catch(() => null);
        if (expandingAreaHTML) {
          specifications.rawSpecificationsHTML = expandingAreaHTML;
          console.log('  Captured raw specifications HTML');
        }
        
        // 11. Also get the text content of the entire expanding area
        const expandingAreaText = await page.$eval('[data-tn="expanding-area"]', el => el.textContent.trim())
          .catch(() => null);
        if (expandingAreaText) {
          specifications.rawSpecificationsText = expandingAreaText;
          console.log('  Captured raw specifications text');
        }
        
      } catch (error) {
        console.error('Error extracting specifications:', error.message);
        
        // Fallback: Try to extract structured information from general spec section
        console.log('Falling back to general specifications extraction...');
        
        try {
          // Look for any product specifications section
          const specSections = await page.$$('.product-specs, .specifications, .details');
          
          if (specSections.length > 0) {
            console.log(`Found ${specSections.length} potential specification sections`);
            
            // Extract text from first section found
            const rawSpecText = await specSections[0].evaluate(node => node.textContent.trim());
            specifications.rawText = rawSpecText;
            
            // Extract any property pairs (label: value)
            const specRows = await page.$$('.spec-row, .property-row, .detail-row');
            
            if (specRows.length > 0) {
              console.log(`Found ${specRows.length} specification rows`);
              
              for (const row of specRows) {
                try {
                  const label = await row.$eval('.label, .property-label', el => el.textContent.trim());
                  const value = await row.$eval('.value, .property-value', el => el.textContent.trim());
                  
                  if (label && value) {
                    // Clean up label to use as property name
                    const propName = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
                    specifications[propName] = value;
                    console.log(`  Found ${label}: ${value}`);
                  }
                } catch (err) {
                  // Ignore individual row errors
                }
              }
            }
          }
        } catch (fallbackError) {
          console.error('Fallback specification extraction failed:', fallbackError.message);
        }
      }
      
      // Extract the product description with retry
      const description = await this.retry(async () => {
        try {
          return await page.$eval('[data-tn="pdp-description"] p', el => el.textContent.trim());
        } catch (error) {
          console.log('Primary description selector failed, trying fallback...');
          try {
            return await page.$eval('.pdp-description, .product-description', el => el.textContent.trim());
          } catch (error) {
            console.log('Description fallback failed, trying most general selector...');
            try {
              return await page.$eval('p:not(:empty)', el => el.textContent.trim());
            } catch (error) {
              return '';
            }
          }
        }
      }).catch(() => '');
      
      console.log(`Description extracted (${description.length} characters)`);
      if (description) {
        console.log(`Description preview: ${description.substring(0, 100)}...`);
      }
      
      // Try to extract JSON-LD data for additional structured information
      const jsonLd = await page.$eval(
        'script[type="application/ld+json"]', 
        el => JSON.parse(el.textContent)
      ).catch(() => null);
      
      // Combine all the extracted data
      return {
        productId,
        slug,
        url,
        name,
        price,
        imageUrl: firstImageUrl,
        description,
        specifications,
        jsonLd
      };
      
    } catch (error) {
      console.error(`Error extracting data from ${url}:`, error.message);
      return null;
    }
  }

  /**
   * Transform raw product data into a standardized format for database storage
   * @param {Object} productData - Raw product data
   * @returns {Object} Standardized product data
   */
  transformProductData(productData) {
    if (!productData) return null;
    
    // Create the standardized data object
    const transformedData = {
      retailer: this.getRetailerName(),
      product_id: productData.productId,
      name: productData.name || '',
      slug: productData.slug,
      price: productData.price || 'Price not available',
      description: productData.description || '',
      image_url: productData.imageUrl || '',
      url: productData.url,
      
      // Store all the detailed specifications
      specifications: productData.specifications || {},
      
      // Store the full raw data for reference
      raw_data: {
        ...productData,
        extractionMethod: 'manual'
      }
    };
    
    return transformedData;
  }

  /**
   * Process multiple products in parallel with controlled concurrency
   * @param {Browser} browser - Playwright browser instance
   * @param {Array<string>} productUrls - Array of product URLs to process
   * @param {Object} options - Configuration options
   * @returns {Promise<Array>} Array of processed products
   */
  async processProductsWithConcurrency(browser, productUrls, options = {}) {
    const {
      onSuccess = () => {},    // Callback when a product is successfully processed
      onFailure = () => {},    // Callback when a product processing fails
      onProgress = () => {},   // Callback for overall progress
      maxProducts = Infinity,  // Maximum number of products to process
      saveDelay = 1000         // Delay between requests to avoid rate limiting
    } = options;
    
    console.log(`Setting up parallel processing with concurrency of ${this.concurrency}`);
    
    // Create the concurrency limiter
    const limit = pLimit(this.concurrency);
    
    // Limit to specified number of products if provided
    const urlsToProcess = productUrls.slice(0, maxProducts);
    console.log(`Will process ${urlsToProcess.length} products with concurrency of ${this.concurrency}`);
    
    // Track progress
    let completedCount = 0;
    let successCount = 0;
    let failureCount = 0;
    const results = [];
    const startTime = Date.now();
    
    // Process products concurrently
    const promises = urlsToProcess.map((url, index) => {
      // Use the limiter to control concurrency
      return limit(async () => {
        const productNumber = index + 1;
        console.log(`Starting product ${productNumber}/${urlsToProcess.length}: ${url}`);
        
        // Add random delay between requests
        const delay = Math.floor(Math.random() * 2000) + saveDelay;
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Create a new context for each product for isolation
        let context = null;
        let page = null;
        
        try {
          // Create a new browser context for each product to avoid cookie/session issues
          context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
          });
          
          // Create a new page for this product
          page = await context.newPage();
          
          // Extract the product data
          const productData = await this.extractProductData(page, url);
          
          if (productData) {
            // Transform the data to standardized format
            const transformedData = this.transformProductData(productData);
            
            if (transformedData) {
              console.log(`✅ Product ${productNumber}: Successfully processed data`);
              successCount++;
              results.push(transformedData);
              
              // Call success callback
              await onSuccess(transformedData, productNumber);
              return transformedData;
            } else {
              console.log(`❌ Product ${productNumber}: Failed to transform data`);
              failureCount++;
              
              // Call failure callback
              await onFailure(url, 'Failed to transform data', productNumber);
              return null;
            }
          } else {
            console.log(`❌ Product ${productNumber}: Failed to extract data`);
            failureCount++;
            
            // Call failure callback
            await onFailure(url, 'Failed to extract data', productNumber);
            return null;
          }
        } catch (error) {
          console.error(`Error processing product ${productNumber}:`, error.message);
          failureCount++;
          
          // Call failure callback
          await onFailure(url, error.message, productNumber);
          return null;
        } finally {
          // Always clean up resources
          if (page) {
            await page.close().catch(() => console.log(`Warning: Could not close page for product ${productNumber}`));
          }
          
          if (context) {
            await context.close().catch(() => console.log(`Warning: Could not close context for product ${productNumber}`));
          }
          
          // Update progress tracking
          completedCount++;
          const elapsedSeconds = (Date.now() - startTime) / 1000;
          const itemsPerSecond = completedCount / elapsedSeconds;
          const estimatedTotalSeconds = urlsToProcess.length / itemsPerSecond;
          const remainingSeconds = estimatedTotalSeconds - elapsedSeconds;
          
          // Progress information
          const progressInfo = {
            total: urlsToProcess.length,
            completed: completedCount,
            success: successCount,
            failure: failureCount,
            percent: Math.round((completedCount / urlsToProcess.length) * 100),
            elapsedSeconds: elapsedSeconds.toFixed(1),
            remainingSeconds: remainingSeconds.toFixed(1),
            estimatedTotalSeconds: estimatedTotalSeconds.toFixed(1),
            itemsPerSecond: itemsPerSecond.toFixed(2)
          };
          
          console.log(`Progress: ${progressInfo.percent}% (${progressInfo.completed}/${progressInfo.total}), Success: ${progressInfo.success}, Failed: ${progressInfo.failure}`);
          
          // Call progress callback
          await onProgress(progressInfo, productNumber);
        }
      });
    });
    
    // Wait for all products to be processed
    console.log('Waiting for all product processing to complete...');
    await Promise.all(promises);
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Completed processing ${urlsToProcess.length} products in ${totalTime} seconds`);
    console.log(`   Success: ${successCount}, Failed: ${failureCount}`);
    
    // Return successful results
    return results.filter(Boolean);
  }
} 