interface ProductCardSkeletonProps {
  count?: number;
}

export function ProductCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-2.5"
    >
      <div>
        <div className="novara-skeleton-shimmer mb-2.5 aspect-square w-full rounded-lg" />
        <div className="space-y-1.5 px-0.5">
          <div className="novara-skeleton-shimmer h-3.5 w-11/12 rounded" />
          <div className="novara-skeleton-shimmer h-3.5 w-2/3 rounded" />
        </div>
        <div className="mt-2 px-0.5">
          <div className="novara-skeleton-shimmer h-3 w-20 rounded" />
        </div>
      </div>

      <div className="mt-3 px-0.5">
        <div className="flex items-baseline gap-2">
          <div className="novara-skeleton-shimmer h-4 w-20 rounded" />
          <div className="novara-skeleton-shimmer h-3 w-12 rounded" />
        </div>
        <div className="novara-skeleton-shimmer mt-2 h-8 w-full rounded-lg" />
      </div>
    </div>
  );
}

export function ProductCardSkeletonGrid({ count = 8 }: ProductCardSkeletonProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, idx) => (
        <ProductCardSkeleton key={`product-skeleton-${idx}`} />
      ))}
    </>
  );
}
