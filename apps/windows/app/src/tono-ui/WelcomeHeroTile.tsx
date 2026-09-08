import heroSrc from '@/assets/welcome-hero.png'

type WelcomeHeroTileProps = {
  size?: 'small'
}

/**
 * Product icon as a physical tile. The PNG is decorative; the wrapper carries
 * the clip, the two sitting-on-the-ground shadows, and the contact ellipse.
 */
export const WelcomeHeroTile = ({ size }: WelcomeHeroTileProps) => (
  <div
    className={
      size === 'small'
        ? 'tono-welcome-hero tono-welcome-hero--small'
        : 'tono-welcome-hero'
    }
    aria-hidden="true"
  >
    <div className="tono-welcome-hero__tile">
      <img src={heroSrc} alt="" width={512} height={512} draggable={false} />
    </div>
  </div>
)
