class PersonDigestJob < ApplicationJob
  queue_as :default

  def perform(person_id)
    person = Person.find(person_id)
    Rails.logger.info("Digest requested for person #{person.id}")
  end
end
