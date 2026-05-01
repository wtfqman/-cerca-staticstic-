export const MAX_KPI_VIEWS = 15_000_000;

export const capKpiViews = (views: number) => Math.min(views, MAX_KPI_VIEWS);
