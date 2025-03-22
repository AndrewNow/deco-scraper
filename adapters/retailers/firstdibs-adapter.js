import { BaseAdapter } from '../base-adapter.js';

/**
 * 1stDibs Adapter
 * 
 * This adapter handles scraping 1stDibs' website.
 */
export class FirstDibsAdapter extends BaseAdapter {
  constructor(country = 'us', language = 'en') {
    super();
    this.country = country;
    this.language = language;
    this.baseUrl = `https://www.1stdibs.com`;
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
   * Extract product links from a category page
   * @param {Page} page - Playwright page object
   * @param {string} url - The category URL to scrape
   * @returns {Promise<Array<string>>} Array of product URLs
   */
  async extractProductLinksFromCategory(page, url) {
    console.log(`Navigating to category page: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle' });
    
    console.log('Page loaded, extracting product links...');
    
    // Debug: Log the page title to confirm we're on the right page
    const title = await page.title();
    console.log(`Page title: ${title}`);
    
    // Take a screenshot to debug
    await page.screenshot({ path: '1stdibs-debug.png' });
    console.log('Saved screenshot to 1stdibs-debug.png for debugging');
    
    // Try several different selectors that might be used on 1stDibs
    
    // 1. Check for product cards
    const productCards = await page.$$('div[data-tn="product-card"]');
    console.log(`Found ${productCards.length} product cards with [data-tn="product-card"]`);
    
    // 2. Try to get links within product cards
    const links = await page.$$eval('div[data-tn="product-card"] a[href*="/furniture/"]', links => 
      links.map(link => link.href)
    ).catch(async (err) => {
      console.error('Error getting links from product cards:', err.message);
      return [];
    });
    
    if (links.length > 0) {
      console.log(`Found ${links.length} products using div[data-tn="product-card"] selector`);
      return links;
    }
    
    // 3. Try a more general approach to find all furniture links
    const furnitureLinks = await page.$$eval('a[href*="/furniture/"][href*="/id-"]', links => 
      links.map(link => link.href)
    ).catch(async (err) => {
      console.error('Error with furniture links selector:', err.message);
      return [];
    });
    
    if (furnitureLinks.length > 0) {
      console.log(`Found ${furnitureLinks.length} products using href pattern matching`);
      return furnitureLinks;
    }
    
    // 4. Most general approach - try to find any links that might be product links
    console.log('Trying more general selectors...');
    
    // Check all links on the page
    const allLinks = await page.$$('a');
    console.log(`Found ${allLinks.length} total links on the page`);
    
    // Look for links that match patterns typically found in product URLs
    const potentialProductLinks = await page.$$eval('a', links => 
      links.filter(link => {
        const href = link.href.toLowerCase();
        return href.includes('/id-') && href.includes('/furniture/');
      }).map(link => link.href)
    );
    
    console.log(`Found ${potentialProductLinks.length} potential product links by filtering all links`);
    
    // If all else fails, log the HTML structure for manual inspection
    if (potentialProductLinks.length === 0) {
      console.log('No product links found. Logging page structure for debugging...');
      const bodyHTML = await page.evaluate(() => document.body.innerHTML.substring(0, 5000)); // First 5000 chars
      console.log('Page HTML preview:', bodyHTML);
    }
    
    return potentialProductLinks;
  }

  /**
   * Handle pagination for a category page
   * @param {Page} page - Playwright page object
   * @returns {Promise<boolean>} True if there's a next page, false otherwise
   */
  async goToNextPage(page) {
    console.log('Checking for pagination elements...');
    
    // Look for the specific 1stDibs "Next" button with data-tn="page-forward"
    const nextButton = await page.$('[data-tn="page-forward"]');
    
    if (nextButton) {
      const isVisible = await nextButton.isVisible();
      console.log(`Found "Next page" button (data-tn="page-forward"), visible: ${isVisible}`);
      
      if (isVisible) {
        console.log('Clicking "Next page" button...');
        await nextButton.click();
        await page.waitForLoadState('networkidle');
        return true;
      }
    } else {
      console.log('No "Next page" button with data-tn="page-forward" found');
    }
    
    // Fallback: Another common pattern is a "Load more" button
    const loadMoreButton = await page.$('button:has-text("Load More")');
    if (loadMoreButton && await loadMoreButton.isVisible()) {
      console.log('Found "Load More" button, clicking it...');
      
      // Get current product count before clicking
      const currentProductCount = await page.$$eval('a[href*="/id-"]', items => items.length);
      
      // Click the button
      await loadMoreButton.click();
      
      // Wait for new products to load
      await page.waitForTimeout(3000);
      
      // Check if more products loaded
      const newProductCount = await page.$$eval('a[href*="/id-"]', items => items.length);
      console.log(`Product count before: ${currentProductCount}, after: ${newProductCount}`);
      
      return newProductCount > currentProductCount;
    }
    
    console.log('No pagination elements found, reached end of products');
    return false;
  }

  /**
   * Extract product data from a product page
   * @param {Page} page - Playwright page object
   * @param {string} url - The product URL to scrape
   * @returns {Promise<Object|null>} Product data object or null if extraction failed
   */
  async extractProductData(page, url) {
    console.log(`Visiting product page: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000); // Additional wait for dynamic content
    
    try {
      // Get product URL slug/ID
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const productIdMatch = url.match(/\/id-([^\/]+)/);
      const productId = productIdMatch ? productIdMatch[1] : pathParts[pathParts.length - 1];
      const slug = pathParts[pathParts.length - 1] || productId;
      
      // 1. Extract the first image URL using the specific selector
      console.log('Extracting first image URL...');
      const firstImageUrl = await page.$eval('[data-tn="pdp-image-carousel-image-1"] figure picture img', img => img.src)
        .catch(async () => {
          console.log('Primary image selector failed, trying fallback...');
          // Fallback 1: Try the selector without requiring all nested elements
          return await page.$eval('[data-tn="pdp-image-carousel-image-1"] img', img => img.src)
            .catch(async () => {
              console.log('Fallback 1 failed, trying more general selectors...');
              // Fallback 2: Try a more general selector for product images
              return await page.$eval('img[data-tn="product-image"]', img => img.src)
                .catch(async () => {
                  // Fallback 3: Get any image in the product gallery
                  return await page.$eval('div[data-tn="product-gallery"] img', img => img.src)
                    .catch(() => {
                      console.log('All image selectors failed');
                      return null;
                    });
                });
            });
        });
      
      console.log(`Image URL found: ${firstImageUrl || 'None'}`);
      
      // 2. Extract basic product details first
      console.log('Extracting basic product details...');
      const name = await page.$eval('h1', el => el.textContent.trim())
        .catch(() => 'Unknown Product');
      
      const price = await page.$eval('[data-tn="price-amount"]', el => el.textContent.trim())
        .catch(() => 'Price not available');
      
      // 3. Extract the item details section
      console.log('Extracting item details section...');
      
      // Check if there's a "Read More" button and click it to expand details
      const hasReadMoreButton = await page.$('[data-tn="read-more"]') !== null;
      if (hasReadMoreButton) {
        console.log('Found "Read More" button, clicking to expand details...');
        await page.click('[data-tn="read-more"]');
        await page.waitForTimeout(1000); // Wait for expansion animation
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
        
        // Fallback to the previous method if specific selectors fail
        console.log('Falling back to previous extraction method...');
        
        // Use the original fallback approach here (the regex-based extraction)
        // This is your existing code for fallback extraction
        // ...
      }
      
      // Extract the product description (separate from specifications)
      const description = await page.$eval('[data-tn="pdp-description"] p', el => el.textContent.trim())
        .catch(async () => {
          // Fallback for description
          return await page.$eval('.pdp-description', el => el.textContent.trim())
            .catch(() => '');
        });
      
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
} 