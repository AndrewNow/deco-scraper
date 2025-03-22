import { BaseAdapter } from '../base-adapter.js';

/**
 * IKEA Adapter
 * 
 * This adapter handles scraping IKEA's website.
 */
export class IkeaAdapter extends BaseAdapter {
  constructor(country = 'ca', language = 'en') {
    super();
    this.country = country;
    this.language = language;
    this.baseUrl = `https://www.ikea.com/${this.country}/${this.language}`;
  }

  /**
   * Get retailer name
   * @returns {string} The retailer name
   */
  getRetailerName() {
    return 'IKEA';
  }

  /**
   * Get default categories to scrape
   * @returns {Array<Object>} Array of category objects with name and url
   */
  getCategories() {
    return [
      {
        name: 'Beds',
        url: `${this.baseUrl}/cat/beds-bm003/`
      },
      {
        name: 'Sofas',
        url: `${this.baseUrl}/cat/sofas-fu003/`
      },
      {
        name: 'Chairs',
        url: `${this.baseUrl}/cat/chairs-fu002/`
      },
      {
        name: 'Tables',
        url: `${this.baseUrl}/cat/tables-desks-fu004/`
      },
      {
        name: 'Storage',
        url: `${this.baseUrl}/cat/storage-furniture-st001/`
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
    
    // Extract product links from current page
    const links = await page.$$eval(`a[href*="/${this.country}/${this.language}/p/"]`, links => 
      links.map(link => link.href)
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
    const nextButton = await page.$('button[aria-label="Next"]');
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
      // Try to extract JSON-LD data
      const jsonLd = await page.$eval(
        'script[type="application/ld+json"]', 
        el => JSON.parse(el.textContent)
      );
      
      // Get product URL slug
      const slug = new URL(url).pathname.split('/').pop();
      
      // Extract IKEA ID from URL or product data
      let productId = '';
      if (url.includes('/p/')) {
        const urlParts = url.split('/p/')[1].split('/');
        productId = urlParts[1] || urlParts[0];
      } else if (jsonLd && jsonLd.sku) {
        productId = jsonLd.sku;
      }
      
      return {
        jsonLd,
        url,
        slug,
        productId
      };
    } catch (error) {
      console.error(`Error extracting JSON from ${url}:`, error.message);
      return null;
    }
  }

  /**
   * Transform raw product data into a standardized format for database storage
   * @param {Object} productData - Raw product data
   * @returns {Object} Standardized product data
   */
  transformProductData(productData) {
    if (!productData || !productData.jsonLd) return null;
    
    const { jsonLd, url, slug, productId } = productData;
    
    // Prepare data for insertion
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
} 