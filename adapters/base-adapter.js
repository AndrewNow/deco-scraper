/**
 * Base Adapter
 * 
 * This is the base class that all retailer-specific adapters should extend.
 * It defines the interface that must be implemented by each adapter.
 */
export class BaseAdapter {
  constructor() {
    if (this.constructor === BaseAdapter) {
      throw new Error("BaseAdapter is an abstract class and cannot be instantiated directly");
    }
  }

  /**
   * Get retailer name
   * @returns {string} The retailer name
   */
  getRetailerName() {
    throw new Error("Method 'getRetailerName()' must be implemented");
  }

  /**
   * Get category URLs to scrape
   * @returns {Array<Object>} Array of category objects with name and url
   */
  getCategories() {
    throw new Error("Method 'getCategories()' must be implemented");
  }

  /**
   * Extract product links from a category page
   * @param {Page} page - Playwright page object
   * @param {string} url - The category URL to scrape
   * @returns {Promise<Array<string>>} Array of product URLs
   */
  async extractProductLinksFromCategory(page, url) {
    throw new Error("Method 'extractProductLinksFromCategory()' must be implemented");
  }

  /**
   * Handle pagination for a category page
   * @param {Page} page - Playwright page object
   * @returns {Promise<boolean>} True if there's a next page, false otherwise
   */
  async goToNextPage(page) {
    throw new Error("Method 'goToNextPage()' must be implemented");
  }

  /**
   * Extract product data from a product page
   * @param {Page} page - Playwright page object
   * @param {string} url - The product URL to scrape
   * @returns {Promise<Object|null>} Product data object or null if extraction failed
   */
  async extractProductData(page, url) {
    throw new Error("Method 'extractProductData()' must be implemented");
  }

  /**
   * Transform raw product data into a standardized format for database storage
   * @param {Object} productData - Raw product data
   * @returns {Object} Standardized product data
   */
  transformProductData(productData) {
    throw new Error("Method 'transformProductData()' must be implemented");
  }
} 