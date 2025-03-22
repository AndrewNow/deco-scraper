import { BaseAdapter } from '../base-adapter.js';

/**
 * Article Adapter
 * 
 * This adapter handles scraping Article's website.
 */
export class ArticleAdapter extends BaseAdapter {
  constructor(country = 'ca', language = 'en') {
    super();
    this.country = country;
    this.language = language;
    this.baseUrl = `https://www.article.com`;
  }

  /**
   * Get retailer name
   * @returns {string} The retailer name
   */
  getRetailerName() {
    return 'Article';
  }

  /**
   * Get default categories to scrape
   * @returns {Array<Object>} Array of category objects with name and url
   */
  getCategories() {
    return [
      {
        name: 'Seating',
        url: `https://www.1stdibs.com/furniture/seating/`
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
    console.log(`Navigating to category page: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle' });
    
    console.log('Page loaded, checking for product cards...');
    
    // Debug: Log the page title to confirm we're on the right page
    const title = await page.title();
    console.log(`Page title: ${title}`);
    
    // Debug: Check if we can find any product elements with different selectors
    const articleCards = await page.$$('.product-card');
    console.log(`Found ${articleCards.length} elements with .product-card class`);
    
    const productCards = await page.$$('[data-testid*="productCard"]');
    console.log(`Found ${productCards.length} elements with data-testid containing productCard`);
    
    const allLinks = await page.$$('a');
    console.log(`Found ${allLinks.length} total link elements on the page`);
    
    // Try to get all product links with a more general selector
    const productLinks = await page.$$eval('a[href*="/product/"]', links => 
      links.map(link => link.href)
    );
    console.log(`Found ${productLinks.length} links containing '/product/' in the href`);
    
    // Original selector attempt
    const links = await page.$$eval('a[data-testid="productGrid-productCard-link"]', links => 
      links.map(link => link.href)
    ).catch(err => {
      console.error('Error with original selector:', err.message);
      return [];
    });
    
    console.log(`Found ${links.length} products with original selector`);
    
    // Return all product links we found
    return productLinks.length > 0 ? productLinks : links;
  }

  /**
   * Handle pagination for a category page
   * @param {Page} page - Playwright page object
   * @returns {Promise<boolean>} True if there's a next page, false otherwise
   */
  async goToNextPage(page) {
    // Article typically uses a "Load more" button rather than pagination
    const loadMoreButton = await page.$('button[data-testid="productGrid-loadMore-button"]');
    
    if (loadMoreButton && await loadMoreButton.isVisible()) {
      console.log('Found "Load more" button, clicking it...');
      
      // Get current product count
      const currentProductCount = await page.$$eval('a[data-testid="productGrid-productCard-link"]', items => items.length);
      
      // Click the load more button
      await loadMoreButton.click();
      
      // Wait for new products to load
      await page.waitForTimeout(3000);
      
      // Check if we loaded more products
      const newProductCount = await page.$$eval('a[data-testid="productGrid-productCard-link"]', items => items.length);
      
      console.log(`Product count before: ${currentProductCount}, after: ${newProductCount}`);
      
      // If we loaded more products, return true
      return newProductCount > currentProductCount;
    }
    
    // Fallback: Try looking for next page button
    const nextButton = await page.$('button[aria-label="Next page"]');
    if (nextButton && await nextButton.isVisible()) {
      console.log('Found "Next page" button, clicking it...');
      await nextButton.click();
      await page.waitForLoadState('networkidle');
      return true;
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
    
    try {
      // Try to extract JSON-LD data
      const jsonLd = await page.$eval(
        'script[type="application/ld+json"]', 
        el => JSON.parse(el.textContent)
      );
      
      // Get product URL slug
      const slug = new URL(url).pathname.split('/').pop();
      
      // Extract Article ID from URL or product data
      let productId = '';
      if (jsonLd && jsonLd.sku) {
        productId = jsonLd.sku;
      } else {
        // Try to extract from URL
        const urlParts = url.split('/');
        productId = urlParts[urlParts.length - 1];
      }
      
      // If still no product ID, try getting it from the DOM
      if (!productId) {
        productId = await page.$eval('[data-testid="product-detail-sku"]', el => el.textContent.trim()).catch(() => '');
      }
      
      return {
        jsonLd,
        url,
        slug,
        productId
      };
    } catch (error) {
      console.error(`Error extracting JSON-LD from ${url}:`, error.message);
      
      // Fallback method for when JSON-LD is not available
      try {
        console.log('Attempting fallback extraction method...');
        
        // Extract using DOM selectors
        const name = await page.$eval('[data-testid="product-detail-title"]', el => el.textContent.trim()).catch(() => '');
        const price = await page.$eval('[data-testid="product-detail-price"]', el => el.textContent.trim()).catch(() => '');
        const description = await page.$eval('[data-testid="product-detail-description"]', el => el.textContent.trim()).catch(() => '');
        
        // Get slug from URL
        const url_obj = new URL(url);
        const pathParts = url_obj.pathname.split('/');
        const slug = pathParts[pathParts.length - 1];
        
        // Get product ID from URL or SKU element
        let productId = await page.$eval('[data-testid="product-detail-sku"]', el => el.textContent.trim()).catch(() => '');
        if (!productId) {
          productId = slug || `article-${Date.now()}`;
        }
        
        if (name) {
          const manualData = {
            manualExtraction: true,
            url,
            slug,
            productId,
            name,
            price,
            description
          };
          
          console.log(`Successfully extracted data manually: ${name}`);
          return manualData;
        }
      } catch (fallbackError) {
        console.error(`Fallback extraction failed for ${url}:`, fallbackError.message);
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
    
    // Handle data from manual extraction
    if (productData.manualExtraction) {
      const { url, slug, productId, name, price, description } = productData;
      
      const rawData = {
        name,
        price,
        description,
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