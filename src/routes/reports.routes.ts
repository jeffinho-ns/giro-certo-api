import { Router, Request, Response } from 'express';
import { ReportService } from '../services/report.service';
import { authenticateToken, AuthRequest, requireModerator } from '../middleware/auth';

const router = Router();
const reportService = new ReportService();

// Relatório de lojistas inadimplentes
router.get(
  '/partners/overdue',
  authenticateToken,
  requireModerator,
  async (req: Request, res: Response) => {
    try {
      const format = (req.query.format as string) || 'json';

      const partners = await reportService.getOverduePartnersReport();

      if (format === 'csv') {
        const csv = reportService.convertToCSV(partners, [
          'id',
          'name',
          'cnpj',
          'companyName',
          'email',
          'phone',
          'isBlocked',
        ]);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="lojistas-inadimplentes.csv"');
        return res.send(csv);
      }

      res.json({ partners });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// Relatório de comissões pendentes
router.get(
  '/commissions/pending',
  authenticateToken,
  requireModerator,
  async (req: Request, res: Response) => {
    try {
      const format = (req.query.format as string) || 'json';
      const startDate = req.query.startDate
        ? new Date(req.query.startDate as string)
        : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const riderId = req.query.riderId as string | undefined;

      const result = await reportService.getPendingCommissionsReport({
        startDate,
        endDate,
        riderId,
      });

      if (format === 'csv') {
        const csv = reportService.convertToCSV(result.transactions, [
          'id',
          'userId',
          'amount',
          'description',
          'status',
          'deliveryOrderId',
          'createdAt',
        ]);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="comissoes-pendentes.csv"');
        return res.send(csv);
      }

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// Ranking de confiabilidade dos entregadores
router.get(
  '/riders/reliability',
  authenticateToken,
  requireModerator,
  async (req: Request, res: Response) => {
    try {
      const format = (req.query.format as string) || 'json';
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

      const rankings = await reportService.getRiderReliabilityRanking(limit);

      if (format === 'csv') {
        const csvData = rankings.map((r) => ({
          riderId: r.rider.id,
          riderName: r.rider.name,
          riderEmail: r.rider.email,
          totalDeliveries: r.totalDeliveries,
          completedDeliveries: r.completedDeliveries,
          cancelledDeliveries: r.cancelledDeliveries,
          averageRating: r.averageRating,
          onTimeRate: r.onTimeRate,
          reliabilityScore: r.reliabilityScore,
        }));

        const csv = reportService.convertToCSV(csvData, [
          'riderId',
          'riderName',
          'riderEmail',
          'totalDeliveries',
          'completedDeliveries',
          'cancelledDeliveries',
          'averageRating',
          'onTimeRate',
          'reliabilityScore',
        ]);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="ranking-confiabilidade.csv"');
        return res.send(csv);
      }

      res.json({ rankings });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

export default router;
