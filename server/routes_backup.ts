import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db, pool } from "./db";
import { z } from "zod";
import {
  insertProductSchema,
  updateProductSchema,
  insertCustomerSchema,
  insertSaleSchema,
  insertSaleItemSchema,
  updateBackupSettingsSchema,
  insertPurchaseOrderSchema,
  insertSupplierSchema,
  insertProductCategorySchema,
  insertSystemPreferenceSchema,
  updateSystemPreferenceSchema,
  insertRolePermissionSchema,
  insertLoginLogSchema,
  insertQuotationSchema,
  insertQuotationItemSchema,
  insertOrderSchema,
  insertOrderItemSchema,
  insertOrderFeeSchema,
  users,
  sales,
  orders,
  products,
} from "@shared/schema";
import {
  eq,
  sql,
  or,
  desc,
  and,
  like,
  gte,
  lte,
  inArray,
  between,
} from "drizzle-orm";
import { registerAccountingRoutes } from "./routes-accounting";
import userRoutes from "./routes-user";
import multer from "multer";
import path from "path";
import { promises as fs } from "fs";
import * as cron from "node-cron";

// Set up multer for receipt uploads
const uploadsDir = path.join(process.cwd(), "uploads");
try {
  fs.mkdir(uploadsDir, { recursive: true });
} catch (err) {
  console.error("Error creating uploads directory:", err);
}

const storage_config = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  },
});

const upload = multer({
  storage: storage_config,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ["image/jpeg", "image/png", "application/pdf"];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPG, PNG, and PDF are allowed."));
    }
  },
});

// Store cron jobs so they can be stopped/updated
const cronJobs: Record<string, cron.ScheduledTask | null> = {
  daily: null,
  weekly: null,
  monthly: null,
};

// In-memory storage for generated orders
let generatedOrdersStorage: any[] = [];

export async function registerRoutes(app: Express): Promise<Server> {
  // Create HTTP server
  const httpServer = createServer(app);

  // Register accounting routes
  registerAccountingRoutes(app);

  // Register user management routes
  app.use("/api", userRoutes);

  // Register payment processing routes
  try {
    const {
      registerPaymentProcessingRoutes,
    } = require("./routes-payment-processing");
    registerPaymentProcessingRoutes(app);
  } catch (err) {
    console.log("Payment processing routes not loaded:", err);
  }

  // Schedule automatic backups
  setupAutomaticBackups();

  // ============= Product Endpoints =============

  // Get all products
  app.get("/api/products", async (req: Request, res: Response) => {
    try {
      let products;
      const { categoryId, status } = req.query;

      if (categoryId) {
        products = await storage.getProductsByCategory(Number(categoryId));
      } else if (status) {
        products = await storage.getProductsByStatus(status as string);
      } else {
        products = await storage.getProducts();
      }

      res.json(products);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  // Get products with low stock
  app.get("/api/products/low-stock", async (req: Request, res: Response) => {
    try {
      const products = await storage.getLowStockProducts();
      res.json(products);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch low stock products" });
    }
  });

  // Get expiring products
  app.get("/api/products/expiring", async (req: Request, res: Response) => {
    try {
      const days = Number(req.query.days) || 30;
      const products = await storage.getExpiringProducts(days);
      res.json(products);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch expiring products" });
    }
  });

  // Get product by ID
  app.get("/api/products/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const product = await storage.getProduct(id);

      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      res.json(product);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch product" });
    }
  });

  // Get raw materials (for production orders)
  app.get("/api/products/raw-materials", (req: Request, res: Response) => {
    try {
      console.log("Fetching raw materials for chemical orders");

      // Sample raw materials data for chemical orders
      const sampleRawMaterials = [
        {
          id: 101,
          name: "Sulfuric Acid",
          drugName: "H2SO4",
          description: "Strong mineral acid with many industrial applications",
          sku: "RAW-001",
          costPrice: "120.00",
          sellingPrice: "0.00",
          productType: "raw",
          status: "active",
          quantity: 500,
          unitOfMeasure: "L",
        },
        {
          id: 102,
          name: "Sodium Hydroxide",
          drugName: "NaOH",
          description: "Highly caustic base and alkali salt",
          sku: "RAW-002",
          costPrice: "150.00",
          sellingPrice: "0.00",
          productType: "raw",
          status: "active",
          quantity: 350,
          unitOfMeasure: "kg",
        },
        {
          id: 103,
          name: "Ethanol",
          drugName: "C2H5OH",
          description: "Primary alcohol used as a solvent",
          sku: "RAW-003",
          costPrice: "95.00",
          sellingPrice: "0.00",
          productType: "raw",
          status: "active",
          quantity: 200,
          unitOfMeasure: "L",
        },
        {
          id: 104,
          name: "Hydrochloric Acid",
          drugName: "HCl",
          description:
            "Strong acid with applications in laboratory and industrial settings",
          sku: "RAW-004",
          costPrice: "110.00",
          sellingPrice: "0.00",
          productType: "raw",
          status: "active",
          quantity: 300,
          unitOfMeasure: "L",
        },
        {
          id: 105,
          name: "Citric Acid",
          drugName: "C6H8O7",
          description:
            "Weak organic acid found in citrus fruits, used as preservative and flavoring",
          sku: "RAW-005",
          costPrice: "85.00",
          sellingPrice: "0.00",
          productType: "raw",
          status: "active",
          quantity: 250,
          unitOfMeasure: "kg",
        },
      ];

      res.json(sampleRawMaterials);
    } catch (error) {
      console.error("Error fetching raw materials:", error);
      res.status(500).json({
        message: "Failed to fetch raw materials",
        error: String(error),
      });
    }
  });

  // Get semi-finished products (for refining orders)
  app.get("/api/products/semi-finished", (req: Request, res: Response) => {
    try {
      console.log("Fetching semi-finished products for chemical orders");

      const sampleSemiFinishedProducts = [
        {
          id: 201,
          name: "Acetylsalicylic Acid Solution",
          drugName: "C9H8O4 Solution",
          description:
            "Semi-refined acetylsalicylic acid solution ready for final processing",
          sku: "SF-001",
          costPrice: "250.00",
          sellingPrice: "0.00",
          productType: "semi-raw",
          status: "active",
          quantity: 150,
          unitOfMeasure: "L",
          batchNumber: "CHEM-0001-250522",
        },
        {
          id: 202,
          name: "Paracetamol Base",
          drugName: "C8H9NO2 Base",
          description: "Partially processed paracetamol base compound",
          sku: "SF-002",
          costPrice: "220.00",
          sellingPrice: "0.00",
          productType: "semi-raw",
          status: "active",
          quantity: 100,
          unitOfMeasure: "kg",
          batchNumber: "CHEM-0002-250522",
        },
        {
          id: 203,
          name: "Caffeine Isolate",
          drugName: "C8H10N4O2 Isolate",
          description: "Purified caffeine extract in intermediate form",
          sku: "SF-003",
          costPrice: "280.00",
          sellingPrice: "0.00",
          productType: "semi-raw",
          status: "active",
          quantity: 75,
          unitOfMeasure: "kg",
          batchNumber: "CHEM-0003-250522",
        },
        {
          id: 204,
          name: "Diclofenac Sodium Base",
          drugName: "C14H10Cl2NNaO2 Base",
          description:
            "Semi-processed diclofenac sodium for pharmaceutical applications",
          sku: "SF-004",
          costPrice: "310.00",
          sellingPrice: "0.00",
          productType: "semi-raw",
          status: "active",
          quantity: 60,
          unitOfMeasure: "kg",
          batchNumber: "CHEM-0004-250522",
        },
        {
          id: 205,
          name: "Ibuprofen Intermediate",
          drugName: "C13H18O2 Intermediate",
          description:
            "Partially refined ibuprofen for anti-inflammatory medications",
          sku: "SF-005",
          costPrice: "245.00",
          sellingPrice: "0.00",
          productType: "semi-raw",
          status: "active",
          quantity: 120,
          unitOfMeasure: "kg",
          batchNumber: "CHEM-0005-250522",
        },
      ];

      res.json(sampleSemiFinishedProducts);
    } catch (error) {
      console.error("Error fetching semi-finished products:", error);
      res.status(500).json({
        message: "Failed to fetch semi-finished products",
        error: String(error),
      });
    }
  });

  // Create new product
  app.post(
    "/api/products",
    upload.single("image"),
    async (req: Request, res: Response) => {
      try {
        const productData = {
          ...req.body,
          categoryId:
            typeof req.body.categoryId === "string"
              ? Number(req.body.categoryId)
              : req.body.categoryId,
          quantity:
            typeof req.body.quantity === "string"
              ? Number(req.body.quantity)
              : req.body.quantity,
          costPrice:
            typeof req.body.costPrice === "string"
              ? Number(req.body.costPrice)
              : req.body.costPrice,
          sellingPrice:
            typeof req.body.sellingPrice === "string"
              ? Number(req.body.sellingPrice)
              : req.body.sellingPrice,
          lowStockThreshold: req.body.lowStockThreshold
            ? Number(req.body.lowStockThreshold)
            : undefined,
          expiryDate: req.body.expiryDate
            ? new Date(req.body.expiryDate)
            : undefined,
        };

        const validatedData = insertProductSchema.parse(productData);

        if (req.file) {
          validatedData.imagePath = req.file.path;
        }

        const product = await storage.createProduct(validatedData);
        res.status(201).json(product);
      } catch (error) {
        console.error("Error creating product:", error);

        if (error instanceof z.ZodError) {
          console.error("Validation errors:", error.errors);
          return res
            .status(400)
            .json({ message: "Invalid product data", errors: error.errors });
        }

        res
          .status(500)
          .json({ message: "Failed to create product", error: String(error) });
      }
    }
  );

  // Update product
  app.patch(
    "/api/products/:id",
    upload.single("image"),
    async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);

        const validatedData = updateProductSchema.parse({
          ...req.body,
          categoryId:
            typeof req.body.categoryId === "string"
              ? Number(req.body.categoryId)
              : req.body.categoryId,
          costPrice:
            typeof req.body.costPrice === "string"
              ? Number(req.body.costPrice)
              : req.body.costPrice,
          sellingPrice:
            typeof req.body.sellingPrice === "string"
              ? Number(req.body.sellingPrice)
              : req.body.sellingPrice,
          quantity:
            typeof req.body.quantity === "string"
              ? Number(req.body.quantity)
              : req.body.quantity,
          lowStockThreshold: req.body.lowStockThreshold
            ? Number(req.body.lowStockThreshold)
            : undefined,
          expiryDate: req.body.expiryDate
            ? new Date(req.body.expiryDate)
            : undefined,
        });

        if (req.file) {
          validatedData.imagePath = req.file.path;
        }

        const product = await storage.updateProduct(id, validatedData);

        if (!product) {
          return res.status(404).json({ message: "Product not found" });
        }

        res.json(product);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res
            .status(400)
            .json({ message: "Invalid product data", errors: error.errors });
        }
        res.status(500).json({ message: "Failed to update product" });
      }
    }
  );

  // Delete product
  app.delete("/api/products/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const success = await storage.deleteProduct(id);

      if (!success) {
        return res.status(404).json({ message: "Product not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete product" });
    }
  });

  // ============= Quotation Endpoints =============

  // Get all quotations
  app.get("/api/quotations", async (req: Request, res: Response) => {
    try {
      console.log("Fetching quotations from database...");

      const quotations = await storage.getQuotations();
      console.log(`Found ${quotations.length} quotations in database`);

      const transformedQuotations = await Promise.all(
        quotations.map(async (quotation) => {
          let customerName = "Unknown Customer";
          if (quotation.customerId) {
            try {
              const customer = await storage.getCustomer(quotation.customerId);
              customerName = customer?.name || "Unknown Customer";
            } catch (error) {
              console.error("Error fetching customer:", error);
            }
          }

          let items = [];
          try {
            const quotationItems = await storage.getQuotationItems(
              quotation.id
            );
            items = await Promise.all(
              quotationItems.map(async (item) => {
                let productName = "Unknown Product";
                try {
                  const product = await storage.getProduct(item.productId);
                  productName = product?.name || "Unknown Product";
                } catch (error) {
                  console.error("Error fetching product:", error);
                }

                return {
                  id: item.id.toString(),
                  type: "finished",
                  productName: productName,
                  description: productName,
                  quantity: parseInt(item.quantity.toString()),
                  uom: "piece",
                  unitPrice: parseFloat(item.unitPrice.toString()),
                  total: parseFloat(item.total.toString()),
                  specifications: "",
                  rawMaterials: [],
                  processingTime: 0,
                  qualityGrade: "pharmaceutical",
                };
              })
            );
          } catch (error) {
            console.error("Error fetching quotation items:", error);
          }

          return {
            id: quotation.id,
            quotationNumber: quotation.quotationNumber,
            type: "finished",
            customerName: customerName,
            customerId: quotation.customerId || 0,
            date: quotation.issueDate
              ? new Date(quotation.issueDate).toISOString().split("T")[0]
              : new Date().toISOString().split("T")[0],
            validUntil: quotation.validUntil
              ? new Date(quotation.validUntil).toISOString().split("T")[0]
              : new Date().toISOString().split("T")[0],
            notes: quotation.notes || "",
            subtotal: parseFloat(quotation.subtotal?.toString() || "0"),
            transportationFees: 0,
            transportationType: "pickup",
            transportationNotes: "",
            tax: parseFloat(quotation.taxAmount?.toString() || "0"),
            total: parseFloat(quotation.grandTotal?.toString() || "0"),
            amount: parseFloat(quotation.grandTotal?.toString() || "0"),
            status: quotation.status || "pending",
            items: items,
          };
        })
      );

      const { query, status, type, date } = req.query;
      let filteredQuotations = [...transformedQuotations];

      if (query && query !== "") {
        const searchTerm = (query as string).toLowerCase();
        filteredQuotations = filteredQuotations.filter(
          (quotation) =>
            quotation.quotationNumber.toLowerCase().includes(searchTerm) ||
            quotation.customerName.toLowerCase().includes(searchTerm) ||
            quotation.items.some((item) =>
              item.productName.toLowerCase().includes(searchTerm)
            )
        );
      }

      if (status && status !== "all") {
        filteredQuotations = filteredQuotations.filter(
          (quotation) => quotation.status === status
        );
      }

      if (type && type !== "all") {
        filteredQuotations = filteredQuotations.filter(
          (quotation) => quotation.type === type
        );
      }

      if (date !== "all") {
        const now = new Date();
        filteredQuotations = filteredQuotations.filter((q) => {
          const quotationDate = new Date(q.date);
          switch (date) {
            case "today":
              return quotationDate.toDateString() === now.toDateString();
            case "week":
              const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
              return quotationDate >= weekAgo;
            case "month":
              const monthAgo = new Date(
                now.getFullYear(),
                now.getMonth() - 1,
                now.getDate()
              );
              return quotationDate >= monthAgo;
            case "year":
              const yearAgo = new Date(
                now.getFullYear() - 1,
                now.getMonth(),
                now.getDate()
              );
              return quotationDate >= yearAgo;
            default:
              return true;
          }
        });
      }

      console.log(
        `Returning ${filteredQuotations.length} quotations after filtering`
      );
      res.json(filteredQuotations);
    } catch (error) {
      console.error("Error fetching quotations:", error);
      res.status(500).json({ message: "Failed to fetch quotations" });
    }
  });

  // Get quotation by ID
  app.get("/api/quotations/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const quotation = await storage.getQuotation(id);

      if (!quotation) {
        return res.status(404).json({ message: "Quotation not found" });
      }

      const items = await storage.getQuotationItems(id);

      res.json({
        ...quotation,
        items,
      });
    } catch (error) {
      console.error("Error fetching quotation:", error);
      res.status(500).json({ message: "Failed to fetch quotation" });
    }
  });

  // Create new quotation
  app.post("/api/quotations", async (req: Request, res: Response) => {
    try {
      console.log(
        "Creating quotation with data:",
        JSON.stringify(req.body, null, 2)
      );

      const quotationData = {
        quotationNumber:
          req.body.quotationNumber || `QT-${Date.now().toString().slice(-6)}`,
        customerId: req.body.customerId || null,
        userId: 1,
        validUntil: req.body.validUntil,
        subtotal: req.body.subtotal?.toString() || "0",
        taxRate: req.body.vatPercentage?.toString() || "14",
        taxAmount: req.body.tax?.toString() || "0",
        grandTotal: req.body.total?.toString() || "0",
        status: req.body.status || "draft",
        notes: req.body.notes || "",
      };

      console.log("Mapped quotation data:", quotationData);

      const validatedQuotation = insertQuotationSchema.parse(quotationData);
      const quotation = await storage.createQuotation(validatedQuotation);
      console.log("Created quotation:", quotation);

      if (
        req.body.items &&
        Array.isArray(req.body.items) &&
        req.body.items.length > 0
      ) {
        console.log("Processing items:", req.body.items);

        for (const item of req.body.items) {
          let productId = item.productId;

          if (!productId) {
            const productData = {
              name: item.productName || "Custom Product",
              drugName: item.productName || "Custom Product",
              categoryId: 1,
              description: item.description || "",
              sku: `CUSTOM-${Date.now()}`,
              costPrice: "0",
              sellingPrice: item.unitPrice?.toString() || "0",
              quantity: 999999,
              unitOfMeasure: item.uom || "piece",
              lowStockThreshold: 10,
              status: "active",
              productType: "finished",
              manufacturer: "Custom",
              location: "Main Warehouse",
            };

            try {
              const validatedProduct = insertProductSchema.parse(productData);
              const product = await storage.createProduct(validatedProduct);
              productId = product.id;
              console.log("Created custom product:", product);
            } catch (productError) {
              console.error("Error creating custom product:", productError);
              continue;
            }
          }

          const itemData = {
            quotationId: quotation.id,
            productId: productId,
            quantity: parseInt(item.quantity?.toString() || "1"),
            unitPrice: item.unitPrice?.toString() || "0",
            total: item.total?.toString() || "0",
          };

          console.log("Creating quotation item:", itemData);

          try {
            const validatedItem = insertQuotationItemSchema.parse(itemData);
            await storage.createQuotationItem(validatedItem);
          } catch (itemError) {
            console.error("Error creating quotation item:", itemError);
          }
        }
      }

      const responseData = {
        ...quotation,
        items: req.body.items || [],
        customerName: req.body.customerName,
      };

      console.log("Returning quotation response:", responseData);
      res.status(201).json(responseData);
    } catch (error) {
      console.error("Error creating quotation:", error);
      if (error instanceof z.ZodError) {
        console.error("Validation errors:", error.errors);
        return res.status(400).json({
          message: "Invalid quotation data",
          errors: error.errors,
          receivedData: req.body,
        });
      }
      res.status(500).json({ message: "Failed to create quotation" });
    }
  });

  // Update quotation status
  app.patch(
    "/api/quotations/:id/status",
    async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        const { status } = req.body;

        if (
          ![
            "draft",
            "sent",
            "pending",
            "accepted",
            "rejected",
            "expired",
          ].includes(status)
        ) {
          return res.status(400).json({ message: "Invalid status value" });
        }

        const quotation = await storage.updateQuotation(id, { status });

        if (!quotation) {
          return res.status(404).json({ message: "Quotation not found" });
        }

        res.json(quotation);
      } catch (error) {
        console.error("Error updating quotation status:", error);
        res.status(500).json({ message: "Failed to update quotation status" });
      }
    }
  );

  // Delete quotation
  app.delete("/api/quotations/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);

      await storage.deleteQuotationItems(id);
      const success = await storage.deleteQuotation(id);

      if (!success) {
        return res.status(404).json({ message: "Quotation not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting quotation:", error);
      res.status(500).json({ message: "Failed to delete quotation" });
    }
  });

  // ============= Continue with other endpoints... =============
  // (The rest of your endpoints would continue here)

  return httpServer;
}

// Function to setup automatic backups
async function setupAutomaticBackups() {
  try {
    const settings = await storage.getBackupSettings();

    for (const job of Object.values(cronJobs)) {
      if (job) job.stop();
    }

    if (settings.dailyBackup) {
      const [hour, minute] = settings.backupTime.split(":");
      cronJobs.daily = cron.schedule(`${minute} ${hour} * * *`, async () => {
        await storage.performBackup("daily");
        console.log("Daily backup completed");
      });
    }

    if (settings.weeklyBackup) {
      const [hour, minute] = settings.backupTime.split(":");
      cronJobs.weekly = cron.schedule(`${minute} ${hour} * * 0`, async () => {
        await storage.performBackup("weekly");
        console.log("Weekly backup completed");
      });
    }

    if (settings.monthlyBackup) {
      const [hour, minute] = settings.backupTime.split(":");
      cronJobs.monthly = cron.schedule(`${minute} ${hour} 1 * *`, async () => {
        await storage.performBackup("monthly");
        console.log("Monthly backup completed");
      });
    }
  } catch (error) {
    console.error("Failed to setup automatic backups:", error);
  }
}
