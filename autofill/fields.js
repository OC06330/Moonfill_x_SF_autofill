// Generated from dev/field-specification.json (updated 2026-11-16). Do not edit by hand: run `npm run generate`; tests check they match.
globalThis.TCA_FIELDS = [
  {
    "label": "Pixel Sent",
    "excluded": false,
    "value": null,
    "rule": "record-created-date",
    "onlyIfEmpty": true
  },
  {
    "label": "Successful Tracking Test",
    "excluded": false,
    "value": null,
    "rule": "today",
    "onlyIfEmpty": true
  },
  {
    "label": "Img tag implemented",
    "excluded": false,
    "value": "Yes"
  },
  {
    "label": "Script tag implemented",
    "excluded": false,
    "value": "Yes"
  },
  {
    "label": "1st party cookie compliant",
    "excluded": false,
    "value": "Yes"
  },
  {
    "label": "Mastertag implemented on all pages",
    "excluded": false,
    "value": "Yes"
  },
  {
    "label": "Server to server",
    "excluded": false,
    "value": "Yes"
  },
  {
    "label": "3rd Party S2S integration tool",
    "excluded": true,
    "value": null
  },
  {
    "label": "Adblocking solution",
    "excluded": false,
    "value": "Yes"
  },
  {
    "label": "Deduplication",
    "excluded": false,
    "value": "Yes"
  },
  {
    "label": "Deduplication Solution",
    "excluded": true,
    "value": null
  },
  {
    "label": "Other Deduplication Solution",
    "excluded": true,
    "value": null
  },
  {
    "label": "Deduplication Parameter",
    "excluded": false,
    "value": "source"
  },
  {
    "label": "Channel parameters implemented",
    "excluded": false,
    "value": "aw"
  },
  {
    "label": "Tag Management Solution",
    "excluded": true,
    "value": null
  },
  {
    "label": "eCommerce platform",
    "excluded": true,
    "value": null
  },
  {
    "label": "Website Platform URL",
    "excluded": true,
    "value": null
  },
  {
    "label": "Other eCommerce platform",
    "excluded": true,
    "value": null
  },
  {
    "label": "Transactional app available",
    "excluded": false,
    "value": "No"
  },
  {
    "label": "Keep users on m-web",
    "excluded": false,
    "value": "No"
  },
  {
    "label": "Moonpull Status",
    "excluded": true,
    "value": null
  },
  {
    "label": "Consent Signals",
    "excluded": true,
    "value": null
  },
  {
    "label": "Transparency & Consent Framework Plugin",
    "excluded": false,
    "value": "No"
  },
  {
    "label": "Voucher Tracking implemented",
    "excluded": false,
    "value": "Unknown"
  },
  {
    "label": "Product Level Tracking implemented",
    "excluded": false,
    "value": "Unknown"
  },
  {
    "label": "Multi-currency implemented",
    "excluded": false,
    "value": "Yes - converted by Clients"
  },
  {
    "label": "VAT and Delivery Implemented",
    "excluded": false,
    "value": "VAT included, delivery excluded"
  },
  {
    "label": "Mobile Site Tracking Implemented",
    "excluded": false,
    "value": "Yes"
  },
  {
    "label": "App tracking provider",
    "excluded": false,
    "value": "No"
  },
  {
    "label": "Other App tracking implemented",
    "excluded": true,
    "value": null
  },
  {
    "label": "Link Builder activated",
    "excluded": false,
    "value": "Yes"
  },
  {
    "label": "Active cross device",
    "excluded": false,
    "value": "No"
  },
  {
    "label": "MT plugins activated",
    "excluded": true,
    "value": null
  },
  {
    "label": "Custom parameters implemented",
    "excluded": false,
    "value": "No"
  },
  {
    "label": "Custom parameters notes",
    "excluded": true,
    "value": null
  },
  {
    "label": "Product Feed uploaded",
    "excluded": false,
    "value": "No"
  },
  {
    "label": "Product Feed format",
    "excluded": true,
    "value": null
  },
  {
    "label": "Batch validation",
    "excluded": false,
    "value": "Yes"
  },
  {
    "label": "Linked Accounts activated",
    "excluded": false,
    "value": "No"
  },
  {
    "label": "AM set up in Awin UI",
    "excluded": true,
    "value": null
  },
  {
    "label": "IP Truncation Level Enabled",
    "excluded": false,
    "value": "Level 4"
  },
  {
    "label": "Transaction Referrer Truncation",
    "excluded": false,
    "value": "Strip path information when no valid domain"
  },
  {
    "label": "AASAF",
    "excluded": false,
    "value": "No"
  },
  {
    "label": "Tech notes",
    "excluded": true,
    "value": null
  },
  {
    "label": "Consent Management Platform",
    "excluded": false,
    "value": "Other"
  }
];
globalThis.TCA_TEMPLATES = [
  {
    "name": "BigCommerce",
    "values": {
      "Deduplication Solution": "Other",
      "Other Deduplication Solution": "BigCommerce plugin",
      "Tag Management Solution": "Other",
      "eCommerce platform": "Bigcommerce",
      "Voucher Tracking implemented": "Unknown",
      "Product Level Tracking implemented": "Yes"
    }
  },
  {
    "name": "Lightspeed",
    "values": {
      "Deduplication Solution": "Other",
      "Other Deduplication Solution": "Lightspeed plugin",
      "Tag Management Solution": "Other",
      "eCommerce platform": "Lightspeed",
      "Voucher Tracking implemented": "Unknown",
      "Product Level Tracking implemented": "Yes"
    }
  },
  {
    "name": "Magento",
    "values": {
      "Deduplication Solution": "Magento",
      "Tag Management Solution": "Magento",
      "eCommerce platform": "Magento",
      "Voucher Tracking implemented": "Unknown",
      "Product Level Tracking implemented": "Yes"
    }
  },
  {
    "name": "OpenCart",
    "values": {
      "Deduplication Solution": "Other",
      "Other Deduplication Solution": "OpenCart plugin",
      "Tag Management Solution": "Other",
      "eCommerce platform": "OpenCart",
      "Voucher Tracking implemented": "Unknown",
      "Product Level Tracking implemented": "Yes"
    }
  },
  {
    "name": "PrestaShop",
    "values": {
      "Deduplication Solution": "Other",
      "Other Deduplication Solution": "PrestaShop plugin",
      "Tag Management Solution": "Other",
      "eCommerce platform": "PrestaShop",
      "Voucher Tracking implemented": "Unknown",
      "Product Level Tracking implemented": "Yes"
    }
  },
  {
    "name": "Salesforce Commerce Cloud",
    "values": {
      "Deduplication Solution": "Other",
      "Other Deduplication Solution": "Salesforce Commerce Cloud plugin",
      "Tag Management Solution": "Other",
      "eCommerce platform": "Salesforce Commerce Cloud",
      "Voucher Tracking implemented": "Unknown",
      "Product Level Tracking implemented": "Yes"
    }
  },
  {
    "name": "Shopify",
    "values": {
      "Deduplication Solution": "Other",
      "Other Deduplication Solution": "Shopify plugin",
      "Tag Management Solution": "Other",
      "eCommerce platform": "Shopify",
      "Voucher Tracking implemented": "Yes",
      "Product Level Tracking implemented": "Yes"
    }
  },
  {
    "name": "Shoplazza",
    "values": {
      "Deduplication Solution": "Other",
      "Other Deduplication Solution": "Shoplazza plugin",
      "Tag Management Solution": "Other",
      "eCommerce platform": "Shoplazza",
      "Voucher Tracking implemented": "Unknown",
      "Product Level Tracking implemented": "Yes"
    }
  },
  {
    "name": "Shopware 5",
    "values": {
      "Deduplication Solution": "Other",
      "Other Deduplication Solution": "Shopware 5 plugin",
      "Tag Management Solution": "Other",
      "eCommerce platform": "Shopware",
      "Voucher Tracking implemented": "Unknown",
      "Product Level Tracking implemented": "Yes"
    }
  },
  {
    "name": "Shopware 6",
    "values": {
      "Deduplication Solution": "Other",
      "Other Deduplication Solution": "Shopware 6 plugin",
      "Tag Management Solution": "Other",
      "eCommerce platform": "Shopware",
      "Voucher Tracking implemented": "Unknown",
      "Product Level Tracking implemented": "Yes"
    }
  },
  {
    "name": "Squarespace",
    "values": {
      "Deduplication Solution": "Other",
      "Other Deduplication Solution": "Squarespace plugin",
      "Tag Management Solution": "Other",
      "eCommerce platform": "Squarespace",
      "Voucher Tracking implemented": "Unknown",
      "Product Level Tracking implemented": "Yes"
    }
  },
  {
    "name": "Wix",
    "values": {
      "Deduplication Solution": "Other",
      "Other Deduplication Solution": "Wix plugin",
      "Tag Management Solution": "Other",
      "eCommerce platform": "Wix",
      "Voucher Tracking implemented": "Unknown",
      "Product Level Tracking implemented": "No"
    }
  },
  {
    "name": "WooCommerce",
    "values": {
      "Deduplication Solution": "Other",
      "Other Deduplication Solution": "WooCommerce plugin",
      "Tag Management Solution": "Other",
      "eCommerce platform": "Wordpress (WooCommerce)",
      "Voucher Tracking implemented": "Unknown",
      "Product Level Tracking implemented": "Yes"
    }
  }
];
