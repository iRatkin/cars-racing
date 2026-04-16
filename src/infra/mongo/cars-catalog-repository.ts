import type { Collection, WithId } from "mongodb";

import type {
  CatalogCar,
  CarsCatalogRepository
} from "../../modules/cars-catalog/cars-catalog-repository.js";

export interface MongoCarDocument {
  carId: string;
  title: string;
  sortOrder: number;
  active: boolean;
  isStarterDefault: boolean;
  isPurchasable: boolean;
  price: { currency: "RC"; amount: number };
  createdAt?: Date;
  updatedAt?: Date;
}


export class MongoCarsCatalogRepository implements CarsCatalogRepository {
  constructor(private readonly collection: Collection<MongoCarDocument>) {}

  async getActiveSortedByOrder(): Promise<CatalogCar[]> {
    const docs = await this.collection
      .find({ active: true })
      .sort({ sortOrder: 1 })
      .toArray();
    return docs.map(mapCarDocument);
  }

  async getById(carId: string): Promise<CatalogCar | null> {
    const doc = await this.collection.findOne({ carId });
    return doc ? mapCarDocument(doc) : null;
  }

  async seedIfEmpty(cars: CatalogCar[]): Promise<void> {
    await seedCarsCatalogIfEmpty(this.collection, cars);
  }

  async getAllCars(): Promise<CatalogCar[]> {
    const docs = await this.collection.find({}).sort({ sortOrder: 1 }).toArray();
    return docs.map(mapCarDocument);
  }

  async upsertCar(car: CatalogCar): Promise<CatalogCar> {
    const now = new Date();
    const doc = await this.collection.findOneAndUpdate(
      { carId: car.carId },
      {
        $set: {
          title: car.title,
          sortOrder: car.sortOrder,
          active: car.active,
          isStarterDefault: car.isStarterDefault,
          isPurchasable: car.isPurchasable,
          price: car.price,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: "after" }
    );
    if (!doc) throw new Error("Upsert car failed");
    return mapCarDocument(doc);
  }

  async setCarActive(carId: string, active: boolean): Promise<CatalogCar | null> {
    const doc = await this.collection.findOneAndUpdate(
      { carId },
      { $set: { active, updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    return doc ? mapCarDocument(doc) : null;
  }

  async getMaxSortOrder(): Promise<number> {
    const doc = await this.collection
      .find({})
      .sort({ sortOrder: -1 })
      .limit(1)
      .next();
    return doc?.sortOrder ?? 0;
  }
}

export async function seedCarsCatalogIfEmpty(
  collection: Collection<MongoCarDocument>,
  cars: CatalogCar[]
): Promise<void> {
  const count = await collection.countDocuments();
  if (count > 0) {
    return;
  }

  const now = new Date();
  const docs: MongoCarDocument[] = cars.map((car) => ({
    carId: car.carId,
    title: car.title,
    sortOrder: car.sortOrder,
    active: car.active,
    isStarterDefault: car.isStarterDefault,
    isPurchasable: car.isPurchasable,
    price: car.price,
    createdAt: now,
    updatedAt: now
  }));

  await collection.insertMany(docs);
}

function mapCarDocument(doc: WithId<MongoCarDocument> | MongoCarDocument): CatalogCar {
  return {
    carId: doc.carId,
    title: doc.title,
    sortOrder: doc.sortOrder,
    active: doc.active,
    isStarterDefault: doc.isStarterDefault,
    isPurchasable: doc.isPurchasable,
    price: doc.price
  };
}
