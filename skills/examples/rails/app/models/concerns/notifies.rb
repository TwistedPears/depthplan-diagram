module Notifies
  extend ActiveSupport::Concern
  included do
    after_update_commit :schedule_digest, if: :saved_change_to_email?
  end

  private

  def schedule_digest
    PersonDigestJob.perform_later(id)
  end
end
