import { BaseAdapter } from '../base-adapter.js';

/**
 * Wayfair Adapter
 * 
 * This adapter handles scraping Wayfair's website.
 */
export class WayfairAdapter extends BaseAdapter {
  constructor(country = 'ca') {
    super();
    this.country = country;
    this.baseUrl = `https://www.wayfair.${this.country}`;
  }

  /**
   * Get retailer name
   * @returns {string} The retailer name
   */
  getRetailerName() {
    return 'Wayfair';
  }

  /**
   * Get default categories to scrape
   * @returns {Array<Object>} Array of category objects with name and url
   */
  getCategories() {
    return [
      {
        name: 'Sofas',
        url: `${this.baseUrl}/furniture/pdp/sofas-c1870557.html`
      },
      {
        name: 'Beds',
        url: `${this.baseUrl}/furniture/pdp/beds-c1870737.html`
      },
      {
        name: 'Dining Tables',
        url: `${this.baseUrl}/furniture/pdp/kitchen-dining-tables-c46129.html`
      },
      {
        name: 'TV Stands',
        url: `${this.baseUrl}/furniture/pdp/tv-stands-c45583.html`
      }
    ];
  }

  /**
   * Extract product links from a category page
   * @param {Page} page - Playwright page object
   * @param {string} url - The category URL to scrape
   * @returns {Promise<Array<string>>} Array of product URLs
   */
  async extractProductLinksFromCategory(page, url) {
    await page.goto(url, { waitUntil: 'networkidle' });
    
    // Extract product links from current page - adjust selectors based on Wayfair's structure
    // This is just an example and may need to be adjusted for Wayfair's actual structure
    const links = await page.$$eval('a[data-hb-id="ProductCard"]', links => 
      links.map(link => link.href).filter(href => href.includes('/pdp/'))
    );
    
    return links;
  }

  /**
   * Handle pagination for a category page
   * @param {Page} page - Playwright page object
   * @returns {Promise<boolean>} True if there's a next page, false otherwise
   */
  async goToNextPage(page) {
    // Check if there's a next page button and click it
    // Adjust this selector based on Wayfair's actual pagination structure
    const nextButton = await page.$('a[data-enzyme-id="PaginationNextPageLink"]');
    if (nextButton && await nextButton.isVisible()) {
      await nextButton.click();
      await page.waitForLoadState('networkidle');
      return true;
    }
    return false;
  }

  /**
   * Extract product data from a product page
   * @param {Page} page - Playwright page object
   * @param {string} url - The product URL to scrape
   * @returns {Promise<Object|null>} Product data object or null if extraction failed
   */
  async extractProductData(page, url) {
    await page.goto(url, { waitUntil: 'networkidle' });
    
    try {
      // Try to extract JSON-LD data - most e-commerce sites use this format
      const jsonLd = await page.$eval(
        'script[type="application/ld+json"]', 
        el => JSON.parse(el.textContent)
      );
      
      // Get product URL slug
      const slug = new URL(url).pathname.split('/').pop().replace('.html', '');
      
      // Extract Wayfair product ID - you might need to adjust this logic
      // Look for a product ID in the URL or in the page content
      let productId = '';
      
      // Example: Extract from URL like /pdp/product-name-SKU123.html
      const match = url.match(/\/pdp\/.*?-([A-Z0-9]+)\.html/);
      if (match && match[1]) {
        productId = match[1];
      } else if (jsonLd && jsonLd.sku) {
        productId = jsonLd.sku;
      }
      
      // Alternative: Extract from page content if not found in URL
      if (!productId) {
        // Example: Try to find a data attribute or element containing the SKU
        productId = await page.$eval('[data-sku]', el => el.getAttribute('data-sku')).catch(() => '');
      }
      
      return {
        jsonLd,
        url,
        slug,
        productId
      };
    } catch (error) {
      console.error(`Error extracting data from ${url}:`, error.message);
      
      // Fallback method if JSON-LD is not available
      try {
        // Extract product information using CSS selectors
        const name = await page.$eval('.ProductDetailInfoBlock-header h1', el => el.textContent.trim()).catch(() => '');
        const price = await page.$eval('[data-enzyme-id="PriceBlock"]', el => el.textContent.trim()).catch(() => '');
        
        // Example: Extract from URL
        const match = url.match(/\/pdp\/.*?-([A-Z0-9]+)\.html/);
        const productId = match ? match[1] : '';
        const slug = new URL(url).pathname.split('/').pop().replace('.html', '');
        
        // If we can get at least a name and ID, return the data
        if (name && productId) {
          return {
            manualExtraction: true,
            url,
            slug,
            productId,
            name,
            price
          };
        }
      } catch (fallbackError) {
        console.error(`Fallback extraction error for ${url}:`, fallbackError.message);
      }
      
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
    
    // Handle data from JSON-LD extraction
    if (productData.jsonLd) {
      const { jsonLd, url, slug, productId } = productData;
      
      return {
        retailer: this.getRetailerName(),
        product_id: productId,
        name: jsonLd.name || '',
        slug: slug,
        price: jsonLd.offers ? JSON.stringify(jsonLd.offers) : null,
        raw_data: jsonLd,
        url: url
      };
    }
    
    // Handle data from fallback manual extraction
    if (productData.manualExtraction) {
      const { url, slug, productId, name, price } = productData;
      
      // Create a structured object for the raw_data field
      const rawData = {
        name,
        price,
        url,
        extractionMethod: 'manual'
      };
      
      return {
        retailer: this.getRetailerName(),
        product_id: productId,
        name: name,
        slug: slug,
        price: JSON.stringify({ price }),
        raw_data: rawData,
        url: url
      };
    }
    
    return null;
  }
} 