import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { CreateUserDto, LoginDto } from '../types';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

export class AuthService {
  async register(data: CreateUserDto) {
    // Verificar se o email já existe
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new Error('Email já cadastrado');
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(data.password, 10);

    // Criar usuário
    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        password: hashedPassword,
        age: data.age,
        pilotProfile: (data.pilotProfile as any) || 'URBANO',
        photoUrl: data.photoUrl,
        // Criar wallet automaticamente
        wallet: {
          create: {
            balance: 0,
            totalEarned: 0,
            totalWithdrawn: 0,
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        age: true,
        photoUrl: true,
        pilotProfile: true,
        isSubscriber: true,
        subscriptionType: true,
        loyaltyPoints: true,
      },
    });

    // Gerar token
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
    const token = jwt.sign(
      { userId: user.id },
      JWT_SECRET,
      { expiresIn } as SignOptions
    );

    return { user, token };
  }

  async login(data: LoginDto) {
    // Buscar usuário
    const user = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (!user) {
      throw new Error('Email ou senha inválidos');
    }

    // Verificar senha
    const validPassword = await bcrypt.compare(data.password, user.password);

    if (!validPassword) {
      throw new Error('Email ou senha inválidos');
    }

    // Gerar token
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
    const token = jwt.sign(
      { userId: user.id },
      JWT_SECRET,
      { expiresIn } as SignOptions
    );

    // Atualizar status online
    await prisma.user.update({
      where: { id: user.id },
      data: { isOnline: true },
    });

    const { password, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      token,
    };
  }

  async logout(userId: string) {
    await prisma.user.update({
      where: { id: userId },
      data: { isOnline: false },
    });

    return { message: 'Logout realizado com sucesso' };
  }
}
