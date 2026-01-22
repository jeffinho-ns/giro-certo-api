import { PrismaClient } from '@prisma/client';

const prismaClientSingleton = () => {
  const config: any = {
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  };
  
  if (process.env.DATABASE_URL) {
    config.datasourceUrl = process.env.DATABASE_URL;
  }
  
  return new PrismaClient(config);
};

declare global {
  var prismaGlobal: undefined | ReturnType<typeof prismaClientSingleton>;
}

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma;
